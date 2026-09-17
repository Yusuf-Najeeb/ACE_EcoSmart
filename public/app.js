const $ = id => document.getElementById(id);
let pending = null;
let pendingLogin = null;
let busy = false;
let currentUser = null;
let recyclerApp = null;
let supportedMaterials = [];
let userMaterialSettings = [];
let recyclerAvailability = 'available';
let selectedMaterial = null;
let currentIntakeMethod = 'manual selection'; // 'manual selection' | 'scan' | 'photo upload'
let currentIntakePhoto = '';
let generatorIntakes = [];
let currentMatches = [];
let selectedMatch = null;
let generatorListings = [];
let incomingRequests = [];
let currentListing = null;
let activeAuthTab = 'register'; // 'register' or 'login'
let screen7CountdownInterval = null;
let chatPollInterval = null;
let currentCallSession = null;
let callDurationInterval = null;
let callPollInterval = null;
let isMicrophoneMuted = false;

// Screen 8 Administrator & Records state
let currentAdminTab = 'apps';
let adminApplications = [];
let adminFilter = 'all';
let adminMaterials = [];
let editingMaterialId = null;
let adminRecords = [];
let adminStats = {};
let userRecords = [];

// Wallet & Bank Account state
let currentWallet = null;
let savedBankAccount = null;
let walletTransactions = [];
let lifetimeTotal = 0;

// File upload in-memory data
const uploadData = {
  govIdFile: '',
  photoFile: '',
  licenceFile: '',
  listingPhotoFile: ''
};

function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
  if (message) $('error').focus();
}

function notice(message) {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Please try again.');
  return result;
}

function cooldown() {
  const regSeconds = pending ? Math.max(0, Math.ceil((pending.resendAt - Date.now()) / 1000)) : 0;
  $('resend').disabled = busy || regSeconds > 0;
  $('resend').textContent = regSeconds ? `Request another code in ${regSeconds}s` : 'Request another code';

  const loginSeconds = pendingLogin ? Math.max(0, Math.ceil((pendingLogin.resendAt - Date.now()) / 1000)) : 0;
  if ($('login-resend')) {
    $('login-resend').disabled = busy || loginSeconds > 0;
    $('login-resend').textContent = loginSeconds ? `Request another code in ${loginSeconds}s` : 'Request another code';
  }
}

async function perform(button, label, action) {
  if (busy) return;
  busy = true;
  error('');
  const original = button.textContent;
  document.querySelectorAll('button').forEach(x => x.disabled = true);
  button.textContent = label;
  try {
    await action();
  } catch (e) {
    error(e.message === 'Failed to fetch' ? 'Connection lost. Please check your connection and try again.' : e.message);
  } finally {
    busy = false;
    button.textContent = original;
    document.querySelectorAll('button').forEach(x => x.disabled = false);
    cooldown();
  }
}

function hideAllScreens() {
  if (screen7CountdownInterval) {
    clearInterval(screen7CountdownInterval);
    screen7CountdownInterval = null;
  }
  if (chatPollInterval) {
    clearInterval(chatPollInterval);
    chatPollInterval = null;
  }
  if (callDurationInterval) {
    clearInterval(callDurationInterval);
    callDurationInterval = null;
  }
  if (callPollInterval) {
    clearInterval(callPollInterval);
    callPollInterval = null;
  }
  $('auth-tabs').hidden = Boolean(currentUser);
  $('registration').hidden = true;
  $('verification').hidden = true;
  $('login-form').hidden = true;
  $('login-verification').hidden = true;
  if ($('complete')) $('complete').hidden = true;
  if ($('screen-3-container')) $('screen-3-container').hidden = true;
  if ($('screen-5-container')) $('screen-5-container').hidden = true;
  if ($('screen-6-container')) $('screen-6-container').hidden = true;
  if ($('screen-7-container')) $('screen-7-container').hidden = true;
  if ($('screen-8-container')) $('screen-8-container').hidden = true;
  $('screen-2-container').hidden = true;
  $('screen-4-container').hidden = true;
  $('header-logout').hidden = !currentUser;
  if ($('header-records-btn')) $('header-records-btn').hidden = !currentUser || currentUser.role === 'administrator';
  if ($('header-admin-btn')) $('header-admin-btn').hidden = !currentUser || currentUser.role !== 'administrator';
}

function switchAuthTab(tab) {
  activeAuthTab = tab;
  error('');
  notice('');
  hideAllScreens();
  $('auth-tabs').hidden = false;

  if (tab === 'register') {
    $('tab-register').classList.add('active');
    $('tab-register').setAttribute('aria-selected', 'true');
    $('tab-login').classList.remove('active');
    $('tab-login').setAttribute('aria-selected', 'false');

    $('stage-label').textContent = 'LET’S GET STARTED';
    $('form-title').textContent = 'Create your account';
    $('form-description').textContent = 'Tell us how you’ll use EcoSmart.';
    $('registration').hidden = false;
    $('step-one').classList.add('current');
    $('step-two').classList.remove('current');
    $('step-three').classList.remove('current');
  } else {
    $('tab-login').classList.add('active');
    $('tab-login').setAttribute('aria-selected', 'true');
    $('tab-register').classList.remove('active');
    $('tab-register').setAttribute('aria-selected', 'false');

    $('stage-label').textContent = 'RETURNING USER';
    $('form-title').textContent = 'Welcome back';
    $('form-description').textContent = 'Sign in to access your EcoSmart account.';
    $('login-form').hidden = false;
    $('step-one').classList.add('current');
    $('step-two').classList.remove('current');
    $('step-three').classList.remove('current');
    $('login-email').focus();
  }
}

function showCode(data) {
  pending = data;
  hideAllScreens();
  $('auth-tabs').hidden = true;
  $('verification').hidden = false;
  $('stage-label').textContent = 'ONE MORE STEP';
  $('form-title').textContent = 'Verify your email';
  $('form-description').textContent = 'Confirm it’s you with a one-time email code.';
  $('sent-to').textContent = `Code sent to ${data.email}.`;
  $('step-one').classList.remove('current');
  $('step-two').classList.add('current');
  $('step-three').classList.remove('current');
  $('code').value = '';
  cooldown();
  $('code').focus();
}

function showLoginCode(data) {
  pendingLogin = data;
  hideAllScreens();
  $('auth-tabs').hidden = true;
  $('login-verification').hidden = false;
  $('stage-label').textContent = 'SIGN IN';
  $('form-title').textContent = 'Enter verification code';
  $('form-description').textContent = 'Enter the 6-digit one-time code sent to your email.';
  $('login-sent-to').textContent = `Sign-in code sent to ${data.email}.`;
  $('step-one').classList.remove('current');
  $('step-two').classList.add('current');
  $('step-three').classList.remove('current');
  $('login-code').value = '';
  cooldown();
  $('login-code').focus();
}

let activeCameraStream = null;
let currentFacingMode = 'environment';

function populateCategoryDropdown() {
  const select = $('intake-category-select');
  if (!select) return;

  const currentVal = selectedMaterial?.id || select.value || '';
  select.innerHTML = '<option value="" disabled selected>-- Select category of your item --</option>';

  const icons = {
    cardboard: '📦',
    pet_plastic_bottles: '🧴',
    aluminium: '🥫',
    brass: '🔩',
    glass: '🍾'
  };

  supportedMaterials.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    const icon = icons[m.id] || '♻️';
    opt.textContent = `${icon} ${m.name}`;
    select.appendChild(opt);
  });

  const otherOpt = document.createElement('option');
  otherOpt.value = 'unsupported';
  otherOpt.textContent = '❓ Other / Non-pilot material';
  select.appendChild(otherOpt);

  if (currentVal) {
    select.value = currentVal;
  }
}

async function selectMaterialCategory(materialId, method = 'manual selection') {
  currentIntakeMethod = method;

  const select = $('intake-category-select');
  if (select && select.value !== materialId) {
    select.value = materialId;
  }

  if (materialId === 'unsupported') {
    selectedMaterial = {
      id: 'unsupported',
      name: 'Other / Non-pilot Material',
      recyclable: false,
      guidance: 'Not supported in this pilot'
    };

    if ($('guidance-panel')) $('guidance-panel').hidden = true;
    if ($('unsupported-panel')) $('unsupported-panel').hidden = false;
    if ($('intake-confirmed-panel')) $('intake-confirmed-panel').hidden = true;

    // Log the unsupported material check
    try {
      const res = await api('/api/generator/intake', {
        materialId: 'unsupported',
        materialName: 'Other / Non-pilot Material',
        intakeMethod: currentIntakeMethod,
        photoFile: currentIntakePhoto || null,
        recyclable: false,
        guidanceTip: 'This pilot only supports cardboard, PET plastic bottles, aluminium, brass, and glass.',
        outcome: 'not supported in this pilot'
      });
      if (res.intakes) {
        generatorIntakes = res.intakes;
        renderGeneratorIntakeHistory();
      }
    } catch {}
    return;
  }

  const mat = supportedMaterials.find(m => m.id === materialId);
  if (!mat) return;

  selectedMaterial = mat;
  if ($('guidance-panel')) $('guidance-panel').hidden = false;
  if ($('unsupported-panel')) $('unsupported-panel').hidden = true;
  if ($('intake-confirmed-panel')) $('intake-confirmed-panel').hidden = true;

  if ($('guidance-material-title')) $('guidance-material-title').textContent = mat.name;
  if ($('guidance-tip-text')) $('guidance-tip-text').textContent = mat.guidance;
  if ($('find-recyclers-btn')) {
    $('find-recyclers-btn').innerHTML = `Find recyclers in ${currentUser?.area || 'your area'} <span aria-hidden="true">→</span>`;
  }
}

function resetGeneratorSelection() {
  selectedMaterial = null;
  currentIntakeMethod = 'manual selection';
  currentIntakePhoto = '';
  stopLiveCamera();
  if ($('intake-category-select')) $('intake-category-select').value = '';
  if ($('guidance-panel')) $('guidance-panel').hidden = true;
  if ($('unsupported-panel')) $('unsupported-panel').hidden = true;
  if ($('intake-confirmed-panel')) $('intake-confirmed-panel').hidden = true;
  if ($('intake-preview-panel')) $('intake-preview-panel').hidden = true;
  if ($('intake-scan-file')) $('intake-scan-file').value = '';
  if ($('intake-upload-file')) $('intake-upload-file').value = '';
}

async function startLiveCamera() {
  currentIntakeMethod = 'scan';

  const modal = $('live-scanner-modal');
  const video = $('scanner-video');
  const overlay = $('scanner-status-overlay');
  const statusText = $('scanner-status-text');

  if (!modal || !video) return;

  // Check camera support
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    notice('Camera not supported by this browser. Please select or upload an image file.');
    if ($('intake-scan-file')) $('intake-scan-file').click();
    return;
  }

  modal.hidden = false;
  if (overlay) overlay.hidden = false;
  if (statusText) statusText.textContent = 'Requesting camera access…';

  try {
    if (activeCameraStream) {
      activeCameraStream.getTracks().forEach(t => t.stop());
      activeCameraStream = null;
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: currentFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    activeCameraStream = stream;
    video.srcObject = stream;
    
    await new Promise(resolve => {
      video.onloadedmetadata = () => {
        video.play().catch(() => {});
        resolve();
      };
    });

    if (overlay) overlay.hidden = true;
  } catch (err) {
    console.warn('Camera access error:', err);
    if (overlay) overlay.hidden = true;
    modal.hidden = true;
    stopLiveCamera();
    notice('Camera unavailable or permission denied. Please choose an image file instead.');
    if ($('intake-scan-file')) $('intake-scan-file').click();
  }
}

function stopLiveCamera() {
  if (activeCameraStream) {
    try {
      activeCameraStream.getTracks().forEach(t => t.stop());
    } catch {}
    activeCameraStream = null;
  }
  const video = $('scanner-video');
  if (video) video.srcObject = null;
  const modal = $('live-scanner-modal');
  if (modal) modal.hidden = true;
}

function captureScan() {
  const video = $('scanner-video');
  if (!video || !video.videoWidth) {
    notice('Camera frame not ready yet. Please wait a second.');
    return;
  }

  const canvas = document.createElement('canvas');
  // Scale sensibly for snappy transfer
  const maxDim = 1024;
  let w = video.videoWidth;
  let h = video.videoHeight;
  if (w > maxDim || h > maxDim) {
    if (w > h) {
      h = Math.round((h * maxDim) / w);
      w = maxDim;
    } else {
      w = Math.round((w * maxDim) / h);
      h = maxDim;
    }
  }
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, w, h);
  const photoData = canvas.toDataURL('image/jpeg', 0.85);

  stopLiveCamera();
  processIntakePhotoData(photoData, 'scan', 'camera_scan.jpg');
}

async function processIntakePhotoData(dataUrl, method, fileName = 'item_photo.jpg') {
  currentIntakeMethod = method;
  currentIntakePhoto = dataUrl;

  if ($('intake-thumbnail-img')) $('intake-thumbnail-img').src = currentIntakePhoto;
  if ($('intake-preview-panel')) $('intake-preview-panel').hidden = false;

  if ($('intake-detected-badge')) $('intake-detected-badge').textContent = method === 'scan' ? '📷 Scanned Item' : '📁 Photo Upload';
  if ($('intake-confidence-pill')) $('intake-confidence-pill').textContent = 'Analysing…';
  if ($('intake-detected-desc')) $('intake-detected-desc').textContent = 'Matching photo against pilot recyclable material catalogue…';

  try {
    const res = await api('/api/generator/intake-analyze', {
      fileName,
      photoFile: currentIntakePhoto
    });

    if (res.detectedMaterialId && res.detectedMaterialId !== 'unsupported') {
      if ($('intake-confidence-pill')) $('intake-confidence-pill').textContent = res.confidence === 'high' ? 'Auto Detected' : 'Suggestion';
      if ($('intake-detected-desc')) $('intake-detected-desc').textContent = `${res.guidance || 'Category matched.'} Please confirm or select another category if needed.`;
      await selectMaterialCategory(res.detectedMaterialId, method);
    } else if (res.detectedMaterialId === 'unsupported') {
      if ($('intake-confidence-pill')) $('intake-confidence-pill').textContent = 'Non-pilot item';
      if ($('intake-detected-desc')) $('intake-detected-desc').textContent = 'Item does not match accepted pilot materials (Cardboard, PET bottles, Aluminium, Brass, Glass).';
      await selectMaterialCategory('unsupported', method);
    } else {
      if ($('intake-confidence-pill')) $('intake-confidence-pill').textContent = 'Select category';
      if ($('intake-detected-desc')) $('intake-detected-desc').textContent = 'Photo attached. Please select the category of your item from the dropdown below.';
    }
  } catch {
    if ($('intake-confidence-pill')) $('intake-confidence-pill').textContent = 'Photo attached';
    if ($('intake-detected-desc')) $('intake-detected-desc').textContent = 'Please select the category of your item from the dropdown below.';
  }
}

async function handleIntakeFile(file, method) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    processIntakePhotoData(e.target.result, method, file.name);
  };
  reader.readAsDataURL(file);
}

function renderGeneratorIntakeHistory() {
  const container = $('intakes-history-list');
  const countPill = $('intakes-count-pill');
  if (!container || !countPill) return;

  countPill.textContent = `${generatorIntakes.length} check${generatorIntakes.length === 1 ? '' : 's'}`;

  if (generatorIntakes.length === 0) {
    container.innerHTML = '<p class="muted empty-note">No recent material checks recorded yet.</p>';
    return;
  }

  container.innerHTML = '';
  generatorIntakes.slice(0, 5).forEach(item => {
    const row = document.createElement('div');
    row.className = 'intake-history-item';
    const isSupported = Boolean(item.recyclable);
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
    
    row.innerHTML = `
      <div>
        <span class="intake-history-title">${item.material_name || item.materialName}</span>
        <div class="intake-history-time">${dateStr} · ${item.intake_method || 'manual selection'}</div>
      </div>
      <span class="badge ${isSupported ? 'badge-approved' : 'badge-rejected'}">
        ${isSupported ? '✓ Recyclable' : '⚠️ Not supported'}
      </span>
    `;
    container.appendChild(row);
  });
}

async function showGeneratorScreen3(user) {
  hideAllScreens();
  $('screen-3-container').hidden = false;
  $('stage-label').textContent = 'SCREEN 3 · FR-06 & FR-07';
  $('form-title').textContent = 'Check my waste';
  $('form-description').textContent = 'Scan or upload your recyclable item, then confirm its category.';

  $('dash-generator-name').textContent = user.name;
  $('dash-generator-area').textContent = user.area;

  $('step-one').classList.remove('current');
  $('step-two').classList.remove('current');
  $('step-three').classList.add('current');

  resetGeneratorSelection();

  if (!supportedMaterials || supportedMaterials.length === 0) {
    try {
      const state = await api('/api/state');
      if (state && Array.isArray(state.materials) && state.materials.length > 0) {
        supportedMaterials = state.materials;
        if (state.intakes) generatorIntakes = state.intakes;
        if (state.listings) generatorListings = state.listings;
        if (state.wallet) currentWallet = state.wallet;
        if (state.bankAccount) savedBankAccount = state.bankAccount;
        if (state.walletTransactions) walletTransactions = state.walletTransactions;
        if (state.lifetimeTotal !== undefined) lifetimeTotal = state.lifetimeTotal;
      }
    } catch {}
  }

  renderWalletCards();
  populateCategoryDropdown();
  renderGeneratorIntakeHistory();
  renderGeneratorListings();
}

function renderGeneratorListings() {
  const containers = [
    { list: $('gen-listings-list'), count: $('gen-listings-count-pill') },
    { list: $('screen3-listings-list'), count: $('screen3-listings-count-pill') }
  ];

  containers.forEach(({ list, count }) => {
    if (!list) return;
    if (count) count.textContent = `${generatorListings.length} listing${generatorListings.length === 1 ? '' : 's'}`;

    if (generatorListings.length === 0) {
      list.innerHTML = '<p class="muted empty-note">No active listings created yet. Select a material above to send requests to buyers.</p>';
      return;
    }

    list.innerHTML = '';
    generatorListings.forEach(item => {
      const card = document.createElement('div');
      card.className = 'listing-item-card';
      card.style.cursor = 'pointer';
      const dateStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
      const qtyStr = item.declared_quantity ? `${item.declared_quantity} ${item.quantity_unit || 'kg'}` : 'Quantity unstated';
      const arrgStr = item.preferred_arrangement === 'pickup' ? '🚚 Pickup' : '📍 Drop-off';
      
      let statusClass = 'badge-sent';
      let statusText = 'Sent to recycler';
      let actionLabel = 'View details →';
      if (item.status === 'accepted') {
        statusClass = 'badge-approved';
        statusText = 'Accepted & Coordinated';
        actionLabel = 'View Contacts →';
      } else if (item.status === 'declined') {
        statusClass = 'badge-rejected';
        statusText = 'Declined';
        actionLabel = 'Rematch →';
      } else if (item.status === 'handover arranged') {
        statusClass = 'badge-approved';
        statusText = 'Handover Arranged';
        actionLabel = 'View Inspection →';
      } else if (item.status === 'funded final offer') {
        statusClass = 'badge-verified';
        statusText = 'Funded Final Offer';
        actionLabel = 'Review Offer & Payout →';
      } else if (item.status === 'completed') {
        statusClass = 'badge-approved';
        statusText = 'Completed & Paid';
        actionLabel = 'View Receipt & Audit →';
      } else if (item.status === 'offer rejected') {
        statusClass = 'badge-rejected';
        statusText = 'Offer Rejected';
        actionLabel = 'View Details →';
      } else if (item.status === 'expired') {
        statusClass = 'badge-rejected';
        statusText = 'Offer Expired';
        actionLabel = 'View Details →';
      } else if (item.status === 'inspected') {
        statusClass = 'badge-verified';
        statusText = 'Inspected';
        actionLabel = 'View Offer →';
      }

      card.innerHTML = `
        <div class="request-item-info">
          <div class="request-item-title">${item.material_name || 'Recyclable Material'} · ${qtyStr}</div>
          <div class="request-item-meta">Buyer: <strong>${item.recycler_name || 'Verified Recycler'}</strong> · ${arrgStr} · ${dateStr}</div>
        </div>
        <div class="request-item-actions">
          <span class="badge ${statusClass}">${statusText}</span>
          <button type="button" class="btn-view-listing" data-id="${item.id}">${actionLabel}</button>
        </div>
      `;
      card.addEventListener('click', () => {
        if (['handover arranged', 'funded final offer', 'completed', 'offer rejected', 'expired'].includes(item.status)) {
          showInspectionScreen7(item.id);
        } else {
          showListingScreen6(item.id);
        }
      });
      list.appendChild(card);
    });
  });
}

function renderMatchingRecyclers(matches) {
  const container = $('matching-recyclers-list');
  const noMatchesBox = $('no-matches-box');
  const form = $('create-listing-form');
  if (!container) return;

  container.innerHTML = '';
  selectedMatch = null;
  form.hidden = true;

  if (matches.length === 0) {
    noMatchesBox.hidden = false;
    $('no-matches-msg').textContent = `No verified recyclers in ${currentUser?.area || 'your area'} are currently accepting ${selectedMaterial?.name || 'this material'}. Check back soon or try another item.`;
    return;
  }

  noMatchesBox.hidden = true;
  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'match-card';
    card.id = `match-card-${m.recyclerId}`;
    
    card.innerHTML = `
      <div class="match-card-info">
        <h4>${m.businessName}</h4>
        <div class="match-meta-row">
          <span class="match-area-pill">📍 ${m.area}</span>
          <span class="match-avail-pill">● Available now</span>
        </div>
      </div>
      <div class="match-card-pricing">
        <div>
          <span class="match-rate">₦${m.estimatedPrice}</span>
          <span class="match-rate-unit">/ ${m.priceUnit}</span>
        </div>
        <button type="button" class="btn-select-match" id="btn-select-${m.recyclerId}">Select Buyer</button>
      </div>
    `;

    function selectThisMatch() {
      document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.btn-select-match').forEach(b => b.textContent = 'Select Buyer');
      card.classList.add('selected');
      card.querySelector('.btn-select-match').textContent = '✓ Selected';

      selectedMatch = m;
      if ($('form-rec-name')) $('form-rec-name').textContent = m.businessName;
      if ($('form-rec-area')) $('form-rec-area').textContent = m.area;
      if ($('form-rec-price')) $('form-rec-price').textContent = `₦${m.estimatedPrice} / ${m.priceUnit}`;
      if ($('send-listing-btn')) $('send-listing-btn').innerHTML = `Send listing to ${m.businessName} <span aria-hidden="true">→</span>`;
      if ($('listing-location')) $('listing-location').value = currentUser?.area || '';

      $('create-listing-form').hidden = false;
      if ($('listing-sent-panel')) $('listing-sent-panel').hidden = true;
      if ($('listing-desc')) $('listing-desc').focus();
    }

    card.addEventListener('click', e => {
      if (e.target.tagName !== 'BUTTON') selectThisMatch();
    });
    card.querySelector('.btn-select-match').addEventListener('click', e => {
      e.stopPropagation();
      selectThisMatch();
    });

    container.appendChild(card);
  });
}

function showGeneratorScreen5(user, material, matches) {
  hideAllScreens();
  $('screen-5-container').hidden = false;
  $('stage-label').textContent = 'SCREEN 5 · FR-08 & FR-09';
  $('form-title').textContent = 'Verified buyers & direct listing';
  $('form-description').textContent = `Matching buyers in your area for ${material.name}.`;

  $('screen5-material-badge').textContent = material.name;
  $('matching-heading').textContent = `Verified Recyclers Buying ${material.name}`;
  $('matching-subheading').textContent = `Found ${matches.length} verified buyer${matches.length === 1 ? '' : 's'} in ${user.area || 'your area'}.`;

  if (currentIntakePhoto && !uploadData.listingPhotoFile) {
    uploadData.listingPhotoFile = currentIntakePhoto;
    if ($('listingPhotoFile-label')) $('listingPhotoFile-label').textContent = '✓ Photo attached from waste intake';
    if ($('listingPhotoFile-drop')) $('listingPhotoFile-drop').classList.add('has-file');
  }

  currentMatches = matches;
  renderMatchingRecyclers(matches);
  renderGeneratorListings();
}

function renderRecyclerIncomingRequests() {
  const container = $('incoming-requests-list');
  const countPill = $('incoming-requests-count-pill');
  if (!container || !countPill) return;

  countPill.textContent = `${incomingRequests.length} request${incomingRequests.length === 1 ? '' : 's'}`;

  if (incomingRequests.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        <div class="empty-icon">📬</div>
        <h4>No incoming requests yet</h4>
        <p class="muted">When nearby generators select you for their recyclable waste, requests will appear here for review and handover arrangement.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  incomingRequests.forEach(req => {
    const card = document.createElement('div');
    card.className = 'incoming-request-card';
    card.style.cursor = 'pointer';
    const dateStr = req.created_at ? new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
    const qtyStr = req.declared_quantity ? `${req.declared_quantity} ${req.quantity_unit || 'kg'}` : 'Quantity unstated';
    const arrgStr = req.preferred_arrangement === 'pickup' ? '🚚 Pickup requested' : '📍 Drop-off planned';

    let statusClass = 'badge-sent';
    let statusText = 'Pending Review';
    let btnLabel = 'Review & Coordinate →';

    if (req.status === 'accepted') {
      statusClass = 'badge-approved';
      statusText = 'Accepted & Coordinated';
      btnLabel = 'View Handover →';
    } else if (req.status === 'declined') {
      statusClass = 'badge-rejected';
      statusText = 'Declined';
      btnLabel = 'View Details →';
    } else if (req.status === 'handover arranged') {
      statusClass = 'badge-approved';
      statusText = 'Handover Arranged';
      btnLabel = 'Record Inspection & Offer →';
    } else if (req.status === 'funded final offer') {
      statusClass = 'badge-verified';
      statusText = 'Funded Final Offer';
      btnLabel = 'View Final Offer →';
    } else if (req.status === 'completed') {
      statusClass = 'badge-approved';
      statusText = 'Completed & Paid';
      btnLabel = 'View Receipt & Audit →';
    } else if (req.status === 'offer rejected') {
      statusClass = 'badge-rejected';
      statusText = 'Offer Rejected';
      btnLabel = 'View Audit →';
    } else if (req.status === 'expired') {
      statusClass = 'badge-rejected';
      statusText = 'Offer Expired';
      btnLabel = 'View Audit →';
    }

    card.innerHTML = `
      <div class="request-item-info">
        <div class="request-item-title">${req.material_name || 'Recyclable Material'} (${qtyStr})</div>
        <div class="request-item-meta">From: <strong>${req.generator_name}</strong> (${req.location_address || req.generator_user_area}) · ${arrgStr} · ${dateStr}</div>
      </div>
      <div class="request-item-actions">
        <span class="badge ${statusClass}">${statusText}</span>
        <button type="button" class="btn-view-listing" data-id="${req.id}">${btnLabel}</button>
      </div>
    `;
    card.addEventListener('click', () => {
      if (['handover arranged', 'funded final offer', 'completed', 'offer rejected', 'expired'].includes(req.status)) {
        showInspectionScreen7(req.id);
      } else {
        showListingScreen6(req.id);
      }
    });
    container.appendChild(card);
  });
}

async function showListingScreen6(listingId) {
  hideAllScreens();
  $('screen-6-container').hidden = false;
  $('stage-label').textContent = 'SCREEN 6 · FR-10 & FR-11';
  $('form-title').textContent = 'Listing & Handover Coordination';
  $('form-description').textContent = 'Direct one-recycler transaction details and coordination.';

  // Reset panels
  $('screen6-recycler-action-panel').hidden = true;
  $('screen6-contacts-panel').hidden = true;
  $('screen6-declined-panel').hidden = true;
  if ($('screen6-proceed-screen7-row')) $('screen6-proceed-screen7-row').hidden = true;

  try {
    const res = await api('/api/listings/details', { listingId });
    const listing = res.listing;
    const resp = res.response;
    currentListing = listing;

    // Header info
    $('screen6-ref-pill').textContent = `REF: #${listing.id.slice(0, 8).toUpperCase()}`;
    
    const statusPill = $('screen6-status-pill');
    let statusClass = 'badge-sent';
    let statusText = 'Sent to Recycler';
    if (listing.status === 'accepted') {
      statusClass = 'badge-approved';
      statusText = 'Accepted & Handover Arranged';
    } else if (listing.status === 'declined') {
      statusClass = 'badge-rejected';
      statusText = 'Declined by Recycler';
    } else if (listing.status === 'handover arranged') {
      statusClass = 'badge-approved';
      statusText = 'Handover Arranged';
    } else if (listing.status === 'funded final offer') {
      statusClass = 'badge-verified';
      statusText = 'Funded Final Offer';
    } else if (listing.status === 'completed') {
      statusClass = 'badge-approved';
      statusText = 'Completed & Paid';
    } else if (listing.status === 'offer rejected') {
      statusClass = 'badge-rejected';
      statusText = 'Offer Rejected';
    } else if (listing.status === 'expired') {
      statusClass = 'badge-rejected';
      statusText = 'Offer Expired';
    } else if (listing.status === 'inspected') {
      statusClass = 'badge-verified';
      statusText = 'Inspected';
    }
    statusPill.className = `badge ${statusClass}`;
    statusPill.textContent = statusText;

    // Details card
    $('screen6-material-badge').textContent = listing.material_name || 'Pilot Material';
    $('screen6-estimated-rate').textContent = `₦${listing.estimated_price || 0} / ${listing.price_unit || 'kg'}`;
    $('screen6-qty-val').textContent = listing.declared_quantity ? `${listing.declared_quantity} ${listing.quantity_unit || 'kg'}` : 'Unspecified';
    $('screen6-arrg-val').textContent = listing.preferred_arrangement === 'pickup' ? '🚚 Pickup from generator' : '📍 Drop-off at recycler yard';
    $('screen6-address-val').textContent = listing.location_address || 'Address provided';
    $('screen6-desc-val').textContent = listing.description || 'No additional notes provided.';

    const isRecycler = currentUser && currentUser.role === 'recycler';
    const isGenerator = currentUser && currentUser.role === 'generator';

    if (listing.status === 'sent to recycler') {
      if ($('btn-screen6-start-call')) $('btn-screen6-start-call').hidden = true;
      if ($('screen6-call-section')) $('screen6-call-section').hidden = true;
      if ($('screen6-chat-section')) $('screen6-chat-section').hidden = true;
      if (isRecycler) {
        $('screen6-recycler-action-panel').hidden = false;
        const radios = document.querySelectorAll('input[name="agreedArrangement"]');
        radios.forEach(r => {
          if (r.value === listing.preferred_arrangement) r.checked = true;
        });
        $('screen6-arrangement-note').value = '';
      }
    } else if (['accepted', 'handover arranged', 'funded final offer', 'inspected', 'completed', 'offer rejected', 'expired'].includes(listing.status)) {
      $('screen6-contacts-panel').hidden = false;
      $('screen6-contact-gen-name').textContent = listing.generator_name || 'Generator';
      $('screen6-contact-gen-email').textContent = listing.generator_email || 'Email shared';
      $('screen6-contact-gen-address').textContent = listing.location_address || 'Handover Address';

      $('screen6-contact-rec-name').textContent = listing.recycler_name || 'Verified Recycler';
      $('screen6-contact-rec-phone').textContent = listing.recycler_phone || 'Phone shared';
      $('screen6-contact-rec-address').textContent = listing.recycler_yard_address || 'Yard Address';

      const arrg = resp?.agreed_arrangement || listing.preferred_arrangement;
      $('screen6-agreed-arrg-title').textContent = `Agreed Handover: ${arrg === 'pickup' ? '🚚 Recycler Pickup' : '📍 Generator Drop-off'}`;
      $('screen6-agreed-instructions').textContent = resp?.arrangement_note ? `Note: "${resp.arrangement_note}"` : 'Direct contact details have been exchanged. Please call or message to finalize time.';
      
      const timeStr = resp?.contacts_shared_at ? new Date(resp.contacts_shared_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recently';
      $('screen6-shared-timestamp').textContent = `Coordinated ${timeStr}`;

      if (isRecycler && listing.status === 'accepted') {
        $('screen6-recycler-complete-row').hidden = false;
      } else {
        $('screen6-recycler-complete-row').hidden = true;
      }

      // In-App Call & Chat controls
      if ($('btn-screen6-start-call')) $('btn-screen6-start-call').hidden = false;
      pollCallStatus(listing.id);
      if (callPollInterval) clearInterval(callPollInterval);
      callPollInterval = setInterval(() => pollCallStatus(listing.id), 3000);

      if ($('screen6-chat-section')) {
        $('screen6-chat-section').hidden = false;
        const otherName = isRecycler ? (listing.generator_name || 'Generator') : (listing.recycler_name || 'Recycler');
        if ($('chat-participants-label')) $('chat-participants-label').textContent = `Chat with ${otherName}`;
        loadChatMessages(listing.id);
        if (chatPollInterval) clearInterval(chatPollInterval);
        chatPollInterval = setInterval(() => loadChatMessages(listing.id, true), 3000);
      }

      if (['handover arranged', 'funded final offer', 'completed', 'offer rejected', 'expired'].includes(listing.status)) {
        if ($('screen6-proceed-screen7-row')) {
          $('screen6-proceed-screen7-row').hidden = false;
          const btn = $('btn-goto-screen7');
          if (btn) {
            if (isRecycler) {
              btn.innerHTML = listing.status === 'handover arranged'
                ? 'Record Inspection & Fund Final Offer <span aria-hidden="true">→</span>'
                : 'View Final Offer & Audit Trail <span aria-hidden="true">→</span>';
            } else {
              btn.innerHTML = listing.status === 'funded final offer'
                ? 'Review Final Offer & Receive Payout <span aria-hidden="true">→</span>'
                : (listing.status === 'completed' ? 'View Payout Receipt & Audit Trail <span aria-hidden="true">→</span>' : 'View Inspection & Offer Details <span aria-hidden="true">→</span>');
            }
            btn.onclick = () => showInspectionScreen7(listing.id);
          }
        }
      }
    } else if (listing.status === 'declined') {
      if ($('btn-screen6-start-call')) $('btn-screen6-start-call').hidden = true;
      if ($('screen6-call-section')) $('screen6-call-section').hidden = true;
      if ($('screen6-chat-section')) $('screen6-chat-section').hidden = true;
      $('screen6-declined-panel').hidden = false;
      $('screen6-decline-note-text').textContent = resp?.decline_reason ? `Reason from recycler: "${resp.decline_reason}"` : 'The recycler is currently at capacity or unable to process this material.';
      if (isGenerator) {
        $('screen6-generator-rematch-row').hidden = false;
      } else {
        $('screen6-generator-rematch-row').hidden = true;
      }
    }
  } catch (err) {
    error(err.message || 'Could not load listing details.');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadChatMessages(listingId, isBackground = false) {
  const stream = $('chat-messages-stream');
  if (!stream || !currentListing || currentListing.id !== listingId) return;

  try {
    const res = await api('/api/chat/messages', { listingId });
    if (!res || !Array.isArray(res.messages)) return;

    if (res.messages.length === 0) {
      if (!isBackground) {
        stream.innerHTML = '<div class="chat-empty-msg">No messages yet. Send a message to coordinate pickup timing or yard drop-off directions.</div>';
      }
      return;
    }

    const currentBubbleCount = stream.querySelectorAll('.chat-bubble-row').length;
    if (isBackground && currentBubbleCount === res.messages.length) {
      return; // No change
    }

    const wasScrolledToBottom = stream.scrollHeight - stream.scrollTop <= stream.clientHeight + 40;

    stream.innerHTML = '';
    res.messages.forEach(msg => {
      const isOutgoing = currentUser && msg.sender_user_id === currentUser.id;
      const row = document.createElement('div');
      row.className = `chat-bubble-row ${isOutgoing ? 'outgoing' : 'incoming'}`;

      const timeStr = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const senderLabel = isOutgoing ? 'You' : (msg.sender_name || (msg.sender_role === 'recycler' ? 'Recycler' : 'Generator'));

      row.innerHTML = `
        <div class="chat-bubble ${isOutgoing ? 'bubble-outgoing' : 'bubble-incoming'}">
          <div class="chat-bubble-meta">
            <span class="chat-sender">${escapeHtml(senderLabel)}</span>
            <span class="chat-time">${escapeHtml(timeStr)}</span>
          </div>
          <div class="chat-bubble-text">${escapeHtml(msg.message)}</div>
        </div>
      `;
      stream.appendChild(row);
    });

    if (!isBackground || wasScrolledToBottom) {
      stream.scrollTop = stream.scrollHeight;
    }
  } catch (err) {
    if (!isBackground) {
      console.warn('Could not load chat messages:', err);
    }
  }
}

// Chat Send Form Listener
if ($('screen6-chat-form')) {
  $('screen6-chat-form').addEventListener('submit', async event => {
    event.preventDefault();
    const inputEl = $('screen6-chat-input');
    if (!inputEl || !currentListing) return;
    const message = inputEl.value.trim();
    if (!message) return;

    const sendBtn = $('btn-screen6-chat-send');
    perform(sendBtn, 'Sending…', async () => {
      await api('/api/chat/send', { listingId: currentListing.id, message });
      inputEl.value = '';
      await loadChatMessages(currentListing.id);
    });
  });
}

// IN-APP CALL (FR-19) CONTROLLER
function formatCallDuration(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function renderCallUI(call) {
  const section = $('screen6-call-section');
  const incomingBox = $('incoming-call-box');
  const outgoingBox = $('outgoing-call-box');
  const activeBox = $('active-call-box');
  const feedbackEl = $('call-feedback-msg');

  if (!section || !incomingBox || !outgoingBox || !activeBox) return;

  if (!call || ['ended', 'declined', 'missed'].includes(call.status)) {
    if (callDurationInterval) {
      clearInterval(callDurationInterval);
      callDurationInterval = null;
    }
    if (currentCallSession && ['ringing', 'connected'].includes(currentCallSession.status) && call) {
      section.hidden = false;
      incomingBox.hidden = true;
      outgoingBox.hidden = true;
      activeBox.hidden = true;
      if (feedbackEl) {
        feedbackEl.hidden = false;
        if (call.status === 'ended') {
          feedbackEl.textContent = `📞 Voice call ended (${formatCallDuration(call.duration_seconds || 0)})`;
        } else if (call.status === 'declined') {
          feedbackEl.textContent = '📞 Call declined';
        } else {
          feedbackEl.textContent = '📞 Missed call';
        }
        setTimeout(() => { feedbackEl.hidden = true; section.hidden = true; }, 4000);
      } else {
        section.hidden = true;
      }
    } else {
      section.hidden = true;
    }
    currentCallSession = call;
    return;
  }

  currentCallSession = call;
  section.hidden = false;
  if (feedbackEl) feedbackEl.hidden = true;

  const isCaller = currentUser && call.caller_user_id === currentUser.id;
  const counterpartName = isCaller ? (call.receiver_name || 'Counterpart') : (call.caller_name || 'Counterpart');
  const counterpartRole = isCaller ? (call.receiver_role === 'recycler' ? 'Verified Recycler' : 'Generator') : (call.caller_role === 'recycler' ? 'Verified Recycler' : 'Generator');

  if (call.status === 'ringing') {
    if (callDurationInterval) {
      clearInterval(callDurationInterval);
      callDurationInterval = null;
    }

    if (isCaller) {
      incomingBox.hidden = true;
      activeBox.hidden = true;
      outgoingBox.hidden = false;
      if ($('outgoing-call-subtitle')) $('outgoing-call-subtitle').textContent = `Ringing ${counterpartName} (${counterpartRole})…`;
    } else {
      outgoingBox.hidden = true;
      activeBox.hidden = true;
      incomingBox.hidden = false;
      if ($('incoming-caller-title')) $('incoming-caller-title').textContent = `Incoming Call from ${counterpartName}`;
      if ($('incoming-caller-subtitle')) $('incoming-caller-subtitle').textContent = `${counterpartRole} · In-App Voice Call`;
    }
  } else if (call.status === 'connected') {
    incomingBox.hidden = true;
    outgoingBox.hidden = true;
    activeBox.hidden = false;

    if ($('active-call-participant')) $('active-call-participant').textContent = `Connected with ${counterpartName} (${counterpartRole})`;

    if (!callDurationInterval) {
      const startTime = call.connected_at || Date.now();
      const updateTimer = () => {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
        if ($('call-duration-timer')) $('call-duration-timer').textContent = formatCallDuration(elapsedSeconds);
      };
      updateTimer();
      callDurationInterval = setInterval(updateTimer, 1000);
    }
  }
}

async function pollCallStatus(listingId) {
  if (!currentListing || currentListing.id !== listingId) return;
  try {
    const res = await api('/api/call/status', { listingId });
    if (res && res.ok) {
      renderCallUI(res.call);
    }
  } catch (err) {
    console.warn('Call status check error:', err);
  }
}

// In-App Call Button Listeners
if ($('btn-screen6-start-call')) {
  $('btn-screen6-start-call').addEventListener('click', () => {
    if (!currentListing) return;
    perform($('btn-screen6-start-call'), 'Starting call…', async () => {
      const res = await api('/api/call/initiate', { listingId: currentListing.id });
      renderCallUI(res.call);
    });
  });
}

if ($('btn-call-answer')) {
  $('btn-call-answer').addEventListener('click', () => {
    if (!currentCallSession) return;
    perform($('btn-call-answer'), 'Connecting…', async () => {
      const res = await api('/api/call/respond', { callId: currentCallSession.id, action: 'answer' });
      renderCallUI(res.call);
    });
  });
}

if ($('btn-call-decline')) {
  $('btn-call-decline').addEventListener('click', () => {
    if (!currentCallSession) return;
    perform($('btn-call-decline'), 'Declining…', async () => {
      const res = await api('/api/call/respond', { callId: currentCallSession.id, action: 'decline' });
      renderCallUI(res.call);
    });
  });
}

if ($('btn-call-cancel')) {
  $('btn-call-cancel').addEventListener('click', () => {
    if (!currentCallSession) return;
    perform($('btn-call-cancel'), 'Cancelling…', async () => {
      const res = await api('/api/call/end', { callId: currentCallSession.id });
      renderCallUI(res.call);
    });
  });
}

if ($('btn-call-end')) {
  $('btn-call-end').addEventListener('click', () => {
    if (!currentCallSession) return;
    perform($('btn-call-end'), 'Ending call…', async () => {
      const res = await api('/api/call/end', { callId: currentCallSession.id });
      renderCallUI(res.call);
    });
  });
}

if ($('btn-call-mute')) {
  $('btn-call-mute').addEventListener('click', () => {
    isMicrophoneMuted = !isMicrophoneMuted;
    const btn = $('btn-call-mute');
    if (isMicrophoneMuted) {
      btn.classList.add('muted');
      btn.textContent = '🔇 Unmute';
    } else {
      btn.classList.remove('muted');
      btn.textContent = '🎤 Mute';
    }
  });
}

function showRecyclerScreen2(user, app) {
  hideAllScreens();
  $('screen-2-container').hidden = false;
  $('stage-label').textContent = 'SCREEN 2 · FR-02';
  $('form-title').textContent = 'Recycler verification application';
  $('form-description').textContent = 'Submit your identification and licence details for administrator review.';
  $('screen2-user-tag').textContent = `${user.name} (${user.email})`;
  
  $('step-one').classList.remove('current');
  $('step-two').classList.remove('current');
  $('step-three').classList.add('current');

  if (!app) {
    // Fresh unsubmitted state
    $('recycler-app-badge').textContent = 'Pending submission';
    $('recycler-app-badge').className = 'badge';
    $('recycler-app-status-panel').hidden = true;
    $('admin-simulation-bar').hidden = true;
    $('recycler-application-form').hidden = false;
    $('appArea').value = user.area || '';
    return;
  }

  // Pre-fill form fields
  $('businessName').value = app.business_name || app.businessName || '';
  $('contactPhone').value = app.contact_phone || app.contactPhone || '';
  $('businessAddress').value = app.business_address || app.businessAddress || '';
  $('govIdType').value = app.gov_id_type || app.govIdType || 'National Identity Number (NIN)';
  $('govIdNumber').value = app.gov_id_number || app.govIdNumber || '';
  $('licenceType').value = app.licence_type || app.licenceType || 'CAC Business Registration';
  $('licenceNumber').value = app.licence_number || app.licenceNumber || '';
  $('appArea').value = app.area || user.area || '';

  uploadData.govIdFile = app.gov_id_file || app.govIdFile || '';
  uploadData.photoFile = app.photo_file || app.photoFile || '';
  uploadData.licenceFile = app.licence_file || app.licenceFile || '';

  if (uploadData.govIdFile) {
    $('govIdFile-label').textContent = '✓ Document attached';
    $('govIdFile-drop').classList.add('has-file');
    $('govIdFile').required = false;
  }
  if (uploadData.photoFile) {
    $('photoFile-label').textContent = '✓ Photo attached';
    $('photoFile-drop').classList.add('has-file');
    $('photoFile').required = false;
  }
  if (uploadData.licenceFile) {
    $('licenceFile-label').textContent = '✓ Licence attached';
    $('licenceFile-drop').classList.add('has-file');
    $('licenceFile').required = false;
  }

  // Handle status
  const status = app.status;
  $('admin-simulation-bar').hidden = !currentUser || currentUser.role !== 'administrator';
  $('recycler-app-status-panel').hidden = false;

  if (status === 'pending') {
    $('recycler-app-badge').textContent = 'Pending Review';
    $('recycler-app-badge').className = 'badge';
    $('recycler-app-status-panel').className = 'status-panel';
    $('status-icon').textContent = '⏳';
    $('status-heading').textContent = 'Application Pending Administrator Review';
    $('status-message').textContent = 'Your documents have been submitted. An administrator must approve your application before you can publish prices and receive generator listings.';
    $('status-note').hidden = true;
    $('approved-action-row').hidden = true;
    $('rejected-action-row').hidden = true;
    $('recycler-application-form').hidden = true;
  } else if (status === 'approved') {
    $('recycler-app-badge').textContent = 'Approved';
    $('recycler-app-badge').className = 'badge badge-approved';
    $('recycler-app-status-panel').className = 'status-panel approved';
    $('status-icon').textContent = '✓';
    $('status-heading').textContent = 'Application Approved!';
    $('status-message').textContent = 'Your recycler profile is verified. You are now authorized to configure accepted materials, prices, and availability.';
    $('status-note').textContent = app.admin_note || app.adminNote || 'Administrator approval granted.';
    $('status-note').hidden = false;
    $('approved-action-row').hidden = false;
    $('rejected-action-row').hidden = true;
    $('recycler-application-form').hidden = true;
  } else if (status === 'rejected') {
    $('recycler-app-badge').textContent = 'Action Required';
    $('recycler-app-badge').className = 'badge badge-rejected';
    $('recycler-app-status-panel').className = 'status-panel rejected';
    $('status-icon').textContent = '⚠️';
    $('status-heading').textContent = 'Application Returned by Administrator';
    $('status-message').textContent = 'Your verification application was rejected. Please review the note below, correct your information, and resubmit.';
    $('status-note').textContent = app.admin_note || app.adminNote || 'Document could not be verified.';
    $('status-note').hidden = false;
    $('approved-action-row').hidden = true;
    $('rejected-action-row').hidden = false;
    $('recycler-application-form').hidden = true;
  }
}

function renderMaterialsDashboard() {
  const container = $('material-settings-list');
  container.innerHTML = '';

  const defaultPrices = {
    cardboard: 120,
    pet_plastic_bottles: 180,
    aluminium: 850,
    brass: 2200,
    glass: 50
  };

  const defaultUnits = {
    cardboard: 'per kilogram',
    pet_plastic_bottles: 'per kilogram',
    aluminium: 'per kilogram',
    brass: 'per kilogram',
    glass: 'per item'
  };

  supportedMaterials.forEach(m => {
    const existing = userMaterialSettings.find(s => s.material_id === m.id || s.materialId === m.id);
    const isAccepted = existing ? Boolean(existing.accepted) : (m.id === 'cardboard' || m.id === 'pet_plastic_bottles');
    const price = existing ? existing.price : (defaultPrices[m.id] || 100);
    const unit = existing ? existing.unit : (defaultUnits[m.id] || 'per kilogram');

    const card = document.createElement('div');
    card.className = 'material-card';
    card.id = `material-card-${m.id}`;
    card.innerHTML = `
      <div class="material-header">
        <label class="material-checkbox-label" for="mat-chk-${m.id}">
          <input type="checkbox" id="mat-chk-${m.id}" data-material="${m.id}" ${isAccepted ? 'checked' : ''}>
          <span>${m.name}</span>
        </label>
        <span class="count-pill">${m.recyclable ? '100% Recyclable' : 'Special Handling'}</span>
      </div>
      <p class="material-guidance">${m.guidance}</p>
      <div class="material-pricing-row">
        <div>
          <label for="mat-price-${m.id}">Estimated Buying Price</label>
          <div class="price-input-wrapper">
            <span class="currency-prefix">₦</span>
            <input type="number" step="any" min="0" id="mat-price-${m.id}" class="price-input" value="${price}" ${!isAccepted ? 'disabled' : ''}>
          </div>
          <span class="estimate-pill">Estimate — not final offer</span>
        </div>
        <div>
          <label for="mat-unit-${m.id}">Price Unit</label>
          <select id="mat-unit-${m.id}" class="unit-select" ${!isAccepted ? 'disabled' : ''}>
            <option value="per kilogram" ${unit === 'per kilogram' ? 'selected' : ''}>per kilogram (kg)</option>
            <option value="per item" ${unit === 'per item' ? 'selected' : ''}>per item</option>
            <option value="per bag" ${unit === 'per bag' ? 'selected' : ''}>per bag</option>
          </select>
        </div>
      </div>
    `;

    // Toggle disabled price/unit when checkbox toggles
    const chk = card.querySelector(`#mat-chk-${m.id}`);
    chk.addEventListener('change', () => {
      const checked = chk.checked;
      card.querySelector(`#mat-price-${m.id}`).disabled = !checked;
      card.querySelector(`#mat-unit-${m.id}`).disabled = !checked;
    });

    container.appendChild(card);
  });
}

function showRecyclerScreen4(user) {
  hideAllScreens();
  $('screen-4-container').hidden = false;
  $('stage-label').textContent = 'SCREEN 4 · FR-03 & FR-04';
  $('form-title').textContent = 'Recycler marketplace dashboard';
  $('form-description').textContent = 'Manage your accepted materials, estimated buying prices, and availability.';

  $('dash-recycler-name').textContent = user.name;
  $('dash-recycler-area').textContent = user.area;

  // Set availability switch
  const isAvail = recyclerAvailability === 'available';
  $('availability-toggle').checked = isAvail;
  $('availability-status-text').textContent = isAvail ? 'Available to receive listings' : 'Unavailable (paused)';
  $('availability-status-text').className = isAvail ? 'status-available' : 'status-unavailable';

  renderWalletCards();
  renderMaterialsDashboard();
  renderRecyclerIncomingRequests();

  $('step-one').classList.remove('current');
  $('step-two').classList.remove('current');
  $('step-three').classList.add('current');
}

function routeUser(user, state) {
  currentUser = user;
  recyclerApp = state.recyclerApplication || null;
  supportedMaterials = state.materials || [];
  userMaterialSettings = state.materialSettings || [];
  generatorIntakes = state.intakes || [];
  generatorListings = state.listings || [];
  incomingRequests = state.incomingRequests || [];
  recyclerAvailability = state.availability || 'available';
  currentWallet = state.wallet || null;
  savedBankAccount = state.bankAccount || null;
  walletTransactions = state.walletTransactions || [];
  lifetimeTotal = state.lifetimeTotal || 0;

  if (!user) {
    if (state.registration) {
      showCode(state.registration);
    } else if (state.pendingLogin) {
      showLoginCode(state.pendingLogin);
    } else {
      switchAuthTab(activeAuthTab);
    }
    return;
  }

  if (user.role === 'administrator') {
    showAdminScreen8('apps');
  } else if (user.role === 'generator') {
    showGeneratorScreen3(user);
  } else if (user.role === 'recycler') {
    if (user.accountStatus === 'active' || user.accountStatus === 'approved') {
      showRecyclerScreen4(user);
    } else {
      showRecyclerScreen2(user, recyclerApp);
    }
  }
}

// File Input Helper
function setupFileInput(inputId, dropId, labelId, key) {
  const input = $(inputId);
  const drop = $(dropId);
  const label = $(labelId);

  if (!input || !drop || !label) return;

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = e => {
        uploadData[key] = e.target.result;
        label.textContent = `✓ ${file.name}`;
        drop.classList.add('has-file');
      };
      reader.readAsDataURL(file);
    }
  });
}

setupFileInput('govIdFile', 'govIdFile-drop', 'govIdFile-label', 'govIdFile');
setupFileInput('photoFile', 'photoFile-drop', 'photoFile-label', 'photoFile');
setupFileInput('licenceFile', 'licenceFile-drop', 'licenceFile-label', 'licenceFile');
setupFileInput('listingPhotoFile', 'listingPhotoFile-drop', 'listingPhotoFile-label', 'listingPhotoFile');

// Tab Switchers
$('tab-register').addEventListener('click', () => switchAuthTab('register'));
$('tab-login').addEventListener('click', () => switchAuthTab('login'));

// Screen 1: Registration
$('registration').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  perform(event.submitter, 'Sending code…', async () => {
    const result = await api('/api/register', data);
    notice('');
    showCode(result);
  });
});

// Screen 1: Verification
$('verification').addEventListener('submit', event => {
  event.preventDefault();
  perform(event.submitter, 'Verifying…', async () => {
    const result = await api('/api/verify', { code: $('code').value.trim() });
    const state = await api('/api/state');
    routeUser(result.user, state);
  });
});

$('resend').addEventListener('click', () => perform($('resend'), 'Sending…', async () => {
  showCode(await api('/api/resend', {}));
  notice('Another code has been requested. Check your inbox and spam folder.');
}));

$('change').addEventListener('click', () => {
  error('');
  notice('');
  switchAuthTab('register');
  $('name').focus();
});

// Returning User: Login Submit
$('login-form').addEventListener('submit', event => {
  event.preventDefault();
  const email = $('login-email').value.trim();
  perform($('login-submit-btn'), 'Sending sign-in code…', async () => {
    const result = await api('/api/login/request', { email });
    notice('');
    showLoginCode(result);
  });
});

// Returning User: Login OTP Verify
$('login-verification').addEventListener('submit', event => {
  event.preventDefault();
  const code = $('login-code').value.trim();
  perform($('verify-login-btn'), 'Signing in…', async () => {
    const result = await api('/api/login/verify', { code });
    const state = await api('/api/state');
    routeUser(result.user, state);
  });
});

$('login-resend').addEventListener('click', () => perform($('login-resend'), 'Sending…', async () => {
  showLoginCode(await api('/api/login/resend', {}));
  notice('Another sign-in code has been sent. Check your inbox.');
}));

$('login-change').addEventListener('click', () => {
  error('');
  notice('');
  switchAuthTab('login');
});

// Screen 2: Submit Verification Application
$('recycler-application-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!uploadData.govIdFile) { error('Please upload a document or scan of your Government ID.'); return; }
  if (!uploadData.photoFile) { error('Please upload your photo.'); return; }
  if (!uploadData.licenceFile) { error('Please upload your licence or registration document.'); return; }

  const payload = {
    businessName: $('businessName').value.trim(),
    contactPhone: $('contactPhone').value.trim(),
    businessAddress: $('businessAddress').value.trim(),
    govIdType: $('govIdType').value.trim(),
    govIdNumber: $('govIdNumber').value.trim(),
    govIdFile: uploadData.govIdFile,
    photoFile: uploadData.photoFile,
    licenceType: $('licenceType').value.trim(),
    licenceNumber: $('licenceNumber').value.trim(),
    licenceFile: uploadData.licenceFile,
    area: $('appArea').value.trim()
  };

  perform($('submit-application-btn'), 'Submitting…', async () => {
    const res = await api('/api/recycler/application', payload);
    notice('Application submitted successfully for administrator review.');
    const state = await api('/api/state');
    routeUser(res.user, state);
  });
});

$('resubmit-app-btn').addEventListener('click', () => {
  $('recycler-app-status-panel').hidden = true;
  $('recycler-application-form').hidden = false;
  $('businessName').focus();
});

$('continue-to-dashboard-btn').addEventListener('click', () => {
  if (currentUser) showRecyclerScreen4(currentUser);
});

// Pilot Admin Review Simulation
$('admin-approve-btn').addEventListener('click', () => {
  if (!recyclerApp) return;
  perform($('admin-approve-btn'), 'Approving…', async () => {
    const res = await api('/api/admin/review-application', {
      applicationId: recyclerApp.id,
      decision: 'approved',
      note: 'Verified by administrator. Licences and ID verified.'
    });
    notice('Application approved! Recycler is now verified.');
    const state = await api('/api/state');
    routeUser(res.user, state);
  });
});

$('admin-reject-btn').addEventListener('click', () => {
  if (!recyclerApp) return;
  const reason = prompt('Enter reason for rejection note:', 'Government ID scan is blurry. Please re-upload a clear copy.');
  if (reason === null) return;
  perform($('admin-reject-btn'), 'Rejecting…', async () => {
    const res = await api('/api/admin/review-application', {
      applicationId: recyclerApp.id,
      decision: 'rejected',
      note: reason || 'Information could not be verified.'
    });
    notice('Application marked rejected.');
    const state = await api('/api/state');
    routeUser(res.user, state);
  });
});

// Screen 4: Availability Switch
$('availability-toggle').addEventListener('change', async () => {
  const isAvail = $('availability-toggle').checked;
  const newStatus = isAvail ? 'available' : 'unavailable';
  $('availability-status-text').textContent = isAvail ? 'Available to receive listings' : 'Unavailable (paused)';
  $('availability-status-text').className = isAvail ? 'status-available' : 'status-unavailable';
  try {
    await api('/api/recycler/availability', { availability: newStatus });
    recyclerAvailability = newStatus;
  } catch (err) {
    error(err.message);
    $('availability-toggle').checked = !isAvail;
  }
});

// Screen 4: Save Marketplace Settings
$('marketplace-settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const settings = supportedMaterials.map(m => {
    const chk = $(`mat-chk-${m.id}`);
    const priceInput = $(`mat-price-${m.id}`);
    const unitSelect = $(`mat-unit-${m.id}`);
    return {
      materialId: m.id,
      accepted: chk ? chk.checked : false,
      price: priceInput ? Number(priceInput.value) || 0 : 0,
      unit: unitSelect ? unitSelect.value : 'per kilogram'
    };
  });

  perform($('save-settings-btn'), 'Saving settings…', async () => {
    const res = await api('/api/recycler/settings', {
      settings,
      availability: $('availability-toggle').checked ? 'available' : 'unavailable'
    });
    userMaterialSettings = res.materialSettings || [];
    $('save-status-msg').hidden = false;
    setTimeout(() => { $('save-status-msg').hidden = true; }, 3500);
  });
});

$('back-to-screen2-btn').addEventListener('click', () => {
  if (currentUser) showRecyclerScreen2(currentUser, recyclerApp);
});

// Screen 3: Generator Actions
// Screen 3: Intake Methods, Live Camera Scanner & Find Recyclers
if ($('btn-intake-manual')) {
  $('btn-intake-manual').addEventListener('click', () => {
    stopLiveCamera();
    currentIntakeMethod = 'manual selection';
    document.querySelectorAll('.intake-method-btn').forEach(b => b.classList.remove('active'));
    $('btn-intake-manual').classList.add('active');
  });
}

if ($('btn-intake-scan')) {
  $('btn-intake-scan').addEventListener('click', () => {
    startLiveCamera();
  });
}

if ($('btn-close-scanner')) {
  $('btn-close-scanner').addEventListener('click', () => {
    stopLiveCamera();
  });
}

if ($('btn-capture-scan')) {
  $('btn-capture-scan').addEventListener('click', () => {
    captureScan();
  });
}

if ($('btn-switch-camera')) {
  $('btn-switch-camera').addEventListener('click', () => {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    startLiveCamera();
  });
}

if ($('btn-scanner-fallback-file')) {
  $('btn-scanner-fallback-file').addEventListener('click', () => {
    stopLiveCamera();
    if ($('intake-scan-file')) $('intake-scan-file').click();
  });
}

if ($('btn-intake-upload')) {
  $('btn-intake-upload').addEventListener('click', () => {
    stopLiveCamera();
    $('intake-upload-file').click();
  });
}

if ($('intake-scan-file')) {
  $('intake-scan-file').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleIntakeFile(e.target.files[0], 'scan');
    }
  });
}

if ($('intake-upload-file')) {
  $('intake-upload-file').addEventListener('change', e => {
    if (e.target.files && e.target.files[0]) {
      handleIntakeFile(e.target.files[0], 'photo upload');
    }
  });
}

if ($('intake-category-select')) {
  $('intake-category-select').addEventListener('change', e => {
    const val = e.target.value;
    if (val) {
      selectMaterialCategory(val, currentIntakePhoto ? currentIntakeMethod : 'manual selection');
    }
  });
}

if ($('btn-clear-intake-photo')) {
  $('btn-clear-intake-photo').addEventListener('click', () => {
    stopLiveCamera();
    currentIntakePhoto = '';
    currentIntakeMethod = 'manual selection';
    if ($('intake-preview-panel')) $('intake-preview-panel').hidden = true;
    if ($('intake-scan-file')) $('intake-scan-file').value = '';
    if ($('intake-upload-file')) $('intake-upload-file').value = '';
    if (!selectedMaterial) {
      if ($('intake-category-select')) $('intake-category-select').value = '';
    }
  });
}

if ($('find-recyclers-btn')) {
  $('find-recyclers-btn').addEventListener('click', () => {
    if (!selectedMaterial) return;
    perform($('find-recyclers-btn'), 'Finding verified buyers…', async () => {
      // 1. Record intake
      const intakeRes = await api('/api/generator/intake', {
        materialId: selectedMaterial.id,
        materialName: selectedMaterial.name,
        intakeMethod: currentIntakeMethod,
        photoFile: currentIntakePhoto || null,
        recyclable: true,
        guidanceTip: selectedMaterial.guidance,
        outcome: 'continued to matching'
      });
      if (intakeRes.intakes) {
        generatorIntakes = intakeRes.intakes;
      }
      // 2. Fetch matches
      const matchesRes = await api('/api/generator/matches', { materialId: selectedMaterial.id });
      // 3. Open Screen 5
      showGeneratorScreen5(currentUser, selectedMaterial, matchesRes.matches || []);
    });
  });
}

if ($('choose-another-btn')) {
  $('choose-another-btn').addEventListener('click', () => {
    resetGeneratorSelection();
    if ($('intake-category-select')) $('intake-category-select').focus();
  });
}

if ($('recheck-waste-btn')) {
  $('recheck-waste-btn').addEventListener('click', () => {
    resetGeneratorSelection();
    if ($('intake-category-select')) $('intake-category-select').focus();
  });
}

// Screen 5: Generator Listing Submission & Navigation
if ($('create-listing-form')) {
  $('create-listing-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!selectedMatch) {
      error('Please select a verified recycler first.');
      return;
    }
    const locationVal = $('listing-location').value.trim();
    if (!locationVal) {
      error('Please provide your pickup or handover address.');
      return;
    }
    const arrgInput = document.querySelector('input[name="arrangement"]:checked');
    const arrangement = arrgInput ? arrgInput.value : 'pickup';
    const qtyVal = $('listing-qty').value ? Number($('listing-qty').value) : null;
    const unitVal = $('listing-unit').value || 'kg';
    const descVal = $('listing-desc').value.trim();

    const payload = {
      recyclerId: selectedMatch.recyclerId,
      materialId: selectedMaterial.id,
      description: descVal,
      photoFile: uploadData.listingPhotoFile || null,
      declaredQuantity: qtyVal,
      quantityUnit: unitVal,
      locationAddress: locationVal,
      preferredArrangement: arrangement
    };

    perform($('send-listing-btn'), 'Sending listing…', async () => {
      const res = await api('/api/generator/listings', payload);
      generatorListings = res.listings || [];
      $('create-listing-form').hidden = true;
      $('listing-sent-panel').hidden = false;

      const qtyText = qtyVal ? `${qtyVal} ${unitVal}` : 'Quantity unstated';
      const arrgText = arrangement === 'pickup' ? '🚚 Pickup from you' : '📍 Drop-off at yard';

      $('listing-sent-summary').innerHTML = `
        <div><strong>Recipient Recycler:</strong> ${selectedMatch.businessName} (${selectedMatch.area})</div>
        <div><strong>Material:</strong> ${selectedMaterial.name}</div>
        <div><strong>Estimated Buying Price:</strong> ₦${selectedMatch.estimatedPrice} / ${selectedMatch.priceUnit}</div>
        <div><strong>Arrangement:</strong> ${arrgText}</div>
        <div><strong>Handover Address:</strong> ${locationVal}</div>
        <div><strong>Status:</strong> Sent to recycler (Awaiting recycler review)</div>
      `;

      renderGeneratorListings();
      notice('Listing sent directly to ' + selectedMatch.businessName + '.');
    });
  });
}

if ($('screen5-back-btn')) $('screen5-back-btn').addEventListener('click', () => showGeneratorScreen3(currentUser));
if ($('no-matches-back-btn')) $('no-matches-back-btn').addEventListener('click', () => showGeneratorScreen3(currentUser));
if ($('check-more-waste-btn')) $('check-more-waste-btn').addEventListener('click', () => showGeneratorScreen3(currentUser));

// Screen 6: Listing and Handover Coordination Handlers
if ($('recycler-response-form')) {
  $('recycler-response-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!currentListing) return;
    const arrgRadio = document.querySelector('input[name="agreedArrangement"]:checked');
    const agreedArrangement = arrgRadio ? arrgRadio.value : 'pickup';
    const arrangementNote = $('screen6-arrangement-note').value.trim();

    perform($('btn-accept-listing'), 'Accepting & sharing contacts…', async () => {
      const res = await api('/api/recycler/listings/respond', {
        listingId: currentListing.id,
        decision: 'accepted',
        agreedArrangement,
        arrangementNote
      });
      notice('Listing accepted! Mutual contact details are now unlocked.');
      await showListingScreen6(currentListing.id);
      const state = await api('/api/state');
      incomingRequests = state.incomingRequests || [];
    });
  });
}

if ($('btn-decline-listing')) {
  $('btn-decline-listing').addEventListener('click', () => {
    if (!currentListing) return;
    const reason = $('screen6-decline-reason').value.trim();
    perform($('btn-decline-listing'), 'Declining listing…', async () => {
      const res = await api('/api/recycler/listings/respond', {
        listingId: currentListing.id,
        decision: 'declined',
        declineReason: reason || 'Recycler currently at capacity'
      });
      notice('Listing declined.');
      await showListingScreen6(currentListing.id);
      const state = await api('/api/state');
      incomingRequests = state.incomingRequests || [];
    });
  });
}

if ($('btn-mark-handover-complete')) {
  $('btn-mark-handover-complete').addEventListener('click', () => {
    if (!currentListing) return;
    perform($('btn-mark-handover-complete'), 'Recording handover…', async () => {
      const res = await api('/api/recycler/listings/handover-complete', {
        listingId: currentListing.id
      });
      notice('Handover marked complete!');
      await showListingScreen6(currentListing.id);
      const state = await api('/api/state');
      incomingRequests = state.incomingRequests || [];
    });
  });
}

if ($('screen6-back-btn')) {
  $('screen6-back-btn').addEventListener('click', async () => {
    if (!currentUser) return;
    if (currentUser.role === 'recycler') {
      const state = await api('/api/state');
      showRecyclerScreen4(currentUser, state);
    } else {
      if (selectedMaterial) {
        const matchesRes = await api('/api/generator/matches', { materialId: selectedMaterial.id });
        showGeneratorScreen5(currentUser, selectedMaterial, matchesRes.matches || []);
      } else {
        showGeneratorScreen3(currentUser);
      }
    }
  });
}

if ($('screen6-rematch-btn')) {
  $('screen6-rematch-btn').addEventListener('click', async () => {
    if (!currentListing) return;
    const matId = currentListing.material_id;
    const matName = currentListing.material_name || 'Pilot Material';
    const mat = { id: matId, name: matName, guidance: '' };
    selectedMaterial = mat;
    const matchesRes = await api('/api/generator/matches', { materialId: matId });
    showGeneratorScreen5(currentUser, mat, matchesRes.matches || []);
  });
}

// ==========================================
// SCREEN 7: Inspection, Final Offer & Decision
// ==========================================

function updateFundingBreakdown() {
  const amountInput = $('screen7-offer-amount');
  const amount = Number(amountInput?.value) || 0;
  const offerEl = $('screen7-breakdown-offer');
  const totalEl = $('screen7-breakdown-total');
  const formatted = `₦${amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
  if (offerEl) offerEl.textContent = formatted;
  if (totalEl) totalEl.textContent = formatted;
}

function renderAuditTimeline(events) {
  const timelineEl = $('screen7-audit-timeline');
  const countPill = $('screen7-audit-count-pill');
  if (!timelineEl) return;

  if (countPill) countPill.textContent = `${events.length} event${events.length === 1 ? '' : 's'}`;

  if (events.length === 0) {
    timelineEl.innerHTML = '<p class="muted empty-note">No audit events recorded yet.</p>';
    return;
  }

  const badgeMap = {
    listing_created: { text: 'Listing Created', class: 'badge-sent' },
    response_accepted: { text: 'Handover Coordinated', class: 'badge-approved' },
    response_declined: { text: 'Listing Declined', class: 'badge-rejected' },
    handover_completed: { text: 'Handover Completed', class: 'badge-approved' },
    inspection_recorded: { text: 'Inspection Verified', class: 'badge-verified' },
    offer_funded_and_sent: { text: 'Escrow Funded & Sent', class: 'badge-verified' },
    offer_accepted: { text: 'Offer Accepted', class: 'badge-approved' },
    payout_released: { text: '₦0-Fee Payout Released', class: 'badge-approved' },
    offer_rejected: { text: 'Offer Rejected', class: 'badge-rejected' },
    offer_expired: { text: 'Offer Expired', class: 'badge-rejected' }
  };

  timelineEl.innerHTML = '';
  events.forEach(evt => {
    const item = document.createElement('div');
    item.className = 'timeline-item';
    const dateStr = new Date(evt.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
    const b = badgeMap[evt.event_type] || { text: evt.event_type, class: 'badge' };

    const note = evt.event_note || evt.description || 'Transaction milestone recorded.';
    const actorRole = evt.actor_role ? (evt.actor_role.charAt(0).toUpperCase() + evt.actor_role.slice(1)) : 'System';
    const actorName = evt.actor_name || (evt.actor_user_id ? evt.actor_user_id.slice(0, 8) : 'EcoSmart Platform');

    item.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-content">
        <div class="timeline-header">
          <span class="badge ${b.class}">${b.text}</span>
          <span class="timeline-time">${dateStr}</span>
        </div>
        <p class="timeline-desc">${note}</p>
        <span class="timeline-actor">Actor: <strong>${actorRole}</strong> (${actorName})</span>
      </div>
    `;
    timelineEl.appendChild(item);
  });
}

async function showInspectionScreen7(listingId) {
  hideAllScreens();
  $('screen-7-container').hidden = false;
  $('stage-label').textContent = 'SCREEN 7 · FR-12 to FR-16';
  $('form-title').textContent = 'Inspection, final offer, and decision';
  $('form-description').textContent = 'Verified physical inspection, funded escrow offer, generator decision, and payout.';

  // Reset panels
  $('screen7-countdown-banner').hidden = true;
  $('screen7-recycler-form-panel').hidden = true;
  $('screen7-generator-decision-panel').hidden = true;
  $('screen7-receipt-panel').hidden = true;
  $('screen7-rejection-drawer').hidden = true;

  try {
    const res = await api('/api/listings/details', { listingId });
    const listing = res.listing;
    currentListing = listing;
    const isRecycler = currentUser && currentUser.role === 'recycler';
    const isGenerator = currentUser && currentUser.role === 'generator';

    // Header info
    $('screen7-ref-pill').textContent = `REF: #${listing.id.slice(0, 8).toUpperCase()}`;

    let statusClass = 'badge-sent';
    let statusText = 'Handover Arranged';
    if (listing.status === 'funded final offer') {
      statusClass = 'badge-verified';
      statusText = 'Funded Final Offer';
    } else if (listing.status === 'completed') {
      statusClass = 'badge-approved';
      statusText = 'Completed & Payout Released';
    } else if (listing.status === 'offer rejected') {
      statusClass = 'badge-rejected';
      statusText = 'Final Offer Rejected';
    } else if (listing.status === 'expired') {
      statusClass = 'badge-rejected';
      statusText = 'Final Offer Expired';
    } else if (listing.status === 'handover arranged') {
      statusClass = 'badge-approved';
      statusText = 'Handover Completed / Awaiting Inspection';
    }
    $('screen7-status-pill').className = `badge ${statusClass}`;
    $('screen7-status-pill').textContent = statusText;

    // Summary card
    $('screen7-material-badge').textContent = listing.material_name || 'Pilot Material';
    $('screen7-initial-estimate').textContent = `₦${listing.estimated_price || 0} / ${listing.price_unit || 'kg'}`;
    $('screen7-gen-name').textContent = `${listing.generator_name || 'Generator'} (${listing.generator_email || ''})`;
    $('screen7-rec-name').textContent = `${listing.recycler_name || 'Verified Recycler'} (${listing.recycler_phone || ''})`;
    $('screen7-declared-qty').textContent = listing.declared_quantity ? `${listing.declared_quantity} ${listing.quantity_unit || 'kg'}` : 'Unstated';
    $('screen7-arrg-val').textContent = listing.preferred_arrangement === 'pickup' ? '🚚 Recycler Pickup' : '📍 Generator Drop-off';

    const inspection = res.inspection;
    const finalOffer = res.finalOffer;
    const payments = res.payments || [];

    // Recycler Form: Handover is arranged or accepted, and no funded final offer is active
    if (isRecycler && (listing.status === 'handover arranged' || listing.status === 'accepted')) {
      $('screen7-recycler-form-panel').hidden = false;
      const declaredQty = Number(listing.declared_quantity) || 1;
      const estRate = Number(listing.estimated_price) || 100;
      $('screen7-actual-qty').value = inspection?.actual_quantity || declaredQty;
      $('screen7-actual-unit').value = inspection?.quantity_unit || listing.quantity_unit || 'kg';
      $('screen7-inspection-note').value = inspection?.notes || '';
      
      const suggestedAmount = Math.round((inspection?.actual_quantity || declaredQty) * estRate);
      $('screen7-offer-amount').value = suggestedAmount > 0 ? suggestedAmount : 100;
      updateFundingBreakdown();
    }

    // Active Funded Final Offer (24h window)
    if (listing.status === 'funded final offer' && finalOffer) {
      $('screen7-countdown-banner').hidden = false;

      function updateCountdown() {
        const remainingMs = finalOffer.expires_at - Date.now();
        if (remainingMs <= 0) {
          $('screen7-countdown-text').textContent = '00h 00m 00s (Offer Expired)';
          $('screen7-countdown-banner').className = 'countdown-banner expired';
          if (screen7CountdownInterval) clearInterval(screen7CountdownInterval);
          if (isGenerator) {
            $('btn-accept-offer').disabled = true;
            $('btn-reject-offer-toggle').disabled = true;
          }
        } else {
          const hours = String(Math.floor(remainingMs / (1000 * 60 * 60))).padStart(2, '0');
          const minutes = String(Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
          const seconds = String(Math.floor((remainingMs % (1000 * 60)) / 1000)).padStart(2, '0');
          $('screen7-countdown-text').textContent = `${hours}h ${minutes}m ${seconds}s remaining`;
        }
      }
      updateCountdown();
      if (screen7CountdownInterval) clearInterval(screen7CountdownInterval);
      screen7CountdownInterval = setInterval(updateCountdown, 1000);

      // Generator Decision Panel
      if (isGenerator) {
        $('screen7-generator-decision-panel').hidden = false;
        $('screen7-verified-weight').textContent = `${inspection?.actual_quantity || finalOffer.offered_quantity || 0} ${inspection?.quantity_unit || finalOffer.quantity_unit || 'kg'}`;
        $('screen7-verified-note').textContent = inspection?.notes ? `"${inspection.notes}"` : 'Inspection completed. Material matches pilot specifications.';
        $('screen7-payout-amount').textContent = `₦${Number(finalOffer.amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
        $('btn-accept-offer').disabled = false;
        $('btn-reject-offer-toggle').disabled = false;
      }
    }

    // Completed / Paid Receipt
    if (listing.status === 'completed') {
      $('screen7-receipt-panel').hidden = false;
      $('screen7-receipt-panel').className = 'receipt-panel';
      $('screen7-receipt-icon').textContent = '✓';
      $('screen7-receipt-icon').className = 'receipt-icon';
      $('screen7-receipt-title').textContent = 'Transaction Completed & Payout Released';
      $('screen7-receipt-subtitle').textContent = '100% of escrow funds released to generator. ₦0.00 commission deducted (Free Pilot).';
      
      const payoutAmount = finalOffer?.amount || payments[0]?.amount || 0;
      $('screen7-receipt-ref').textContent = payments[0]?.id ? `REF-${payments[0].id.slice(0, 10).toUpperCase()}` : `REF-${listing.id.slice(0, 8).toUpperCase()}`;
      $('screen7-receipt-amount').textContent = `₦${Number(payoutAmount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
      $('screen7-receipt-status-badge').className = 'badge badge-approved';
      $('screen7-receipt-status-badge').textContent = 'Payout Released';
      $('screen7-receipt-time').textContent = new Date(listing.updated_at || Date.now()).toLocaleString();
    }

    // Rejected Receipt
    if (listing.status === 'offer rejected') {
      $('screen7-receipt-panel').hidden = false;
      $('screen7-receipt-panel').className = 'receipt-panel rejected';
      $('screen7-receipt-icon').textContent = '↩';
      $('screen7-receipt-icon').className = 'receipt-icon rejected';
      $('screen7-receipt-title').textContent = 'Final Offer Rejected by Generator';
      $('screen7-receipt-subtitle').textContent = 'Escrow deposit has been returned in full to the buyer. No platform fees charged.';
      
      const amount = finalOffer?.amount || 0;
      $('screen7-receipt-ref').textContent = `REF-${listing.id.slice(0, 8).toUpperCase()}`;
      $('screen7-receipt-amount').textContent = `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
      $('screen7-receipt-status-badge').className = 'badge badge-rejected';
      $('screen7-receipt-status-badge').textContent = 'Escrow Returned';
      $('screen7-receipt-time').textContent = new Date(listing.updated_at || Date.now()).toLocaleString();
    }

    // Expired Receipt
    if (listing.status === 'expired') {
      $('screen7-receipt-panel').hidden = false;
      $('screen7-receipt-panel').className = 'receipt-panel rejected';
      $('screen7-receipt-icon').textContent = '⏳';
      $('screen7-receipt-icon').className = 'receipt-icon rejected';
      $('screen7-receipt-title').textContent = 'Offer Expired (24 Hours Elapsed)';
      $('screen7-receipt-subtitle').textContent = 'Generator did not respond within the 24-hour decision window. Escrow funds returned to recycler.';
      
      const amount = finalOffer?.amount || 0;
      $('screen7-receipt-ref').textContent = `REF-${listing.id.slice(0, 8).toUpperCase()}`;
      $('screen7-receipt-amount').textContent = `₦${Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
      $('screen7-receipt-status-badge').className = 'badge badge-rejected';
      $('screen7-receipt-status-badge').textContent = 'Expired / Escrow Refunded';
      $('screen7-receipt-time').textContent = new Date(listing.updated_at || Date.now()).toLocaleString();
    }

    // Render Audit Trail Timeline
    renderAuditTimeline(res.events || []);

  } catch (err) {
    error(err.message || 'Could not load inspection details.');
  }
}

// Screen 7: Inspection and Offer submission
if ($('screen7-offer-amount')) {
  $('screen7-offer-amount').addEventListener('input', updateFundingBreakdown);
}

if ($('inspection-offer-form')) {
  $('inspection-offer-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!currentListing) return;
    const actualQty = Number($('screen7-actual-qty').value);
    const actualUnit = $('screen7-actual-unit').value;
    const notes = $('screen7-inspection-note').value.trim();
    const amount = Number($('screen7-offer-amount').value);

    if (amount <= 0) {
      error('Please enter a valid final offer amount in Naira.');
      return;
    }

    perform($('btn-fund-send-offer'), 'Securing escrow & sending offer…', async () => {
      const res = await api('/api/recycler/inspection/submit-offer', {
        listingId: currentListing.id,
        actualQuantity: actualQty,
        quantityUnit: actualUnit,
        inspectionNotes: notes,
        amount
      });
      notice('Final offer funded into escrow and sent! 24-hour decision window started.');
      await showInspectionScreen7(currentListing.id);
      const state = await api('/api/state');
      incomingRequests = state.incomingRequests || [];
      if (state.wallet) currentWallet = state.wallet;
      if (state.bankAccount) savedBankAccount = state.bankAccount;
      if (state.walletTransactions) walletTransactions = state.walletTransactions;
      if (state.lifetimeTotal !== undefined) lifetimeTotal = state.lifetimeTotal;
      renderWalletCards();
    });
  });
}

// Screen 7: Generator Offer Decisions
if ($('btn-accept-offer')) {
  $('btn-accept-offer').addEventListener('click', () => {
    if (!currentListing) return;
    perform($('btn-accept-offer'), 'Releasing payout…', async () => {
      const res = await api('/api/generator/offer/decision', {
        listingId: currentListing.id,
        decision: 'accept'
      });
      notice('Final offer accepted! Payout released with ₦0 commission (Free Pilot).');
      await showInspectionScreen7(currentListing.id);
      const state = await api('/api/state');
      generatorListings = state.listings || [];
      if (state.wallet) currentWallet = state.wallet;
      if (state.bankAccount) savedBankAccount = state.bankAccount;
      if (state.walletTransactions) walletTransactions = state.walletTransactions;
      if (state.lifetimeTotal !== undefined) lifetimeTotal = state.lifetimeTotal;
      renderWalletCards();
    });
  });
}

if ($('btn-reject-offer-toggle')) {
  $('btn-reject-offer-toggle').addEventListener('click', () => {
    const drawer = $('screen7-rejection-drawer');
    if (drawer) {
      drawer.hidden = !drawer.hidden;
      if (!drawer.hidden) $('screen7-rejection-reason').focus();
    }
  });
}

if ($('btn-confirm-reject-offer')) {
  $('btn-confirm-reject-offer').addEventListener('click', () => {
    if (!currentListing) return;
    const reason = $('screen7-rejection-reason').value.trim();
    perform($('btn-confirm-reject-offer'), 'Returning escrow funds…', async () => {
      const res = await api('/api/generator/offer/decision', {
        listingId: currentListing.id,
        decision: 'reject',
        rejectionReason: reason || 'Generator declined final offer.'
      });
      notice('Offer rejected. Recycler escrow deposit has been returned.');
      await showInspectionScreen7(currentListing.id);
      const state = await api('/api/state');
      generatorListings = state.listings || [];
      if (state.wallet) currentWallet = state.wallet;
      if (state.bankAccount) savedBankAccount = state.bankAccount;
      if (state.walletTransactions) walletTransactions = state.walletTransactions;
      if (state.lifetimeTotal !== undefined) lifetimeTotal = state.lifetimeTotal;
      renderWalletCards();
    });
  });
}

if ($('screen7-back-btn')) {
  $('screen7-back-btn').addEventListener('click', () => {
    if (currentListing) {
      showListingScreen6(currentListing.id);
    } else if (currentUser?.role === 'recycler') {
      showRecyclerScreen4(currentUser);
    } else {
      showGeneratorScreen3(currentUser);
    }
  });
}

if ($('screen7-logout-btn')) {
  $('screen7-logout-btn').addEventListener('click', () => perform($('screen7-logout-btn'), 'Signing out…', handleSignOut));
}

// ==========================================
// SCREEN 8: Administrator Workspace & Records
// ==========================================

async function showAdminScreen8(tab = 'apps') {
  hideAllScreens();
  $('screen-8-container').hidden = false;

  const isAdmin = currentUser?.role === 'administrator';

  if (!isAdmin) {
    tab = 'myrecords';
    $('stage-label').textContent = 'TRANSACTION HISTORY';
    $('form-title').textContent = 'Your Marketplace Records';
    $('form-description').textContent = 'View your recyclable waste listings, inspection outcomes, and completed payouts.';
    if ($('screen8-main-heading')) $('screen8-main-heading').textContent = 'Your Transaction Records';

    if ($('admin-tab-apps')) $('admin-tab-apps').hidden = true;
    if ($('admin-tab-materials')) $('admin-tab-materials').hidden = true;
    if ($('admin-tab-records')) $('admin-tab-records').hidden = true;
    if ($('admin-tab-myrecords')) $('admin-tab-myrecords').hidden = false;
    if ($('admin-close-btn')) $('admin-close-btn').hidden = false;
    if ($('screen8-back-btn')) $('screen8-back-btn').hidden = false;
  } else {
    $('stage-label').textContent = 'SCREEN 8 · FR-17';
    $('form-title').textContent = 'Pilot Administrator Workspace';
    $('form-description').textContent = 'Review verification queue, manage material catalogue, and search transaction records.';
    if ($('screen8-main-heading')) $('screen8-main-heading').textContent = 'Pilot Administrator Workspace';

    if ($('admin-tab-apps')) $('admin-tab-apps').hidden = false;
    if ($('admin-tab-materials')) $('admin-tab-materials').hidden = false;
    if ($('admin-tab-records')) $('admin-tab-records').hidden = false;
    if ($('admin-tab-myrecords')) $('admin-tab-myrecords').hidden = true;
    if ($('admin-close-btn')) $('admin-close-btn').hidden = true;
    if ($('screen8-back-btn')) $('screen8-back-btn').hidden = true;
  }

  switchAdminTab(tab);
}

function switchAdminTab(tab) {
  currentAdminTab = tab;
  ['apps', 'materials', 'records', 'myrecords'].forEach(t => {
    const btn = $(`admin-tab-${t}`);
    const panel = $(`admin-${t}-panel`);
    if (btn) {
      if (t === tab) {
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
      }
    }
    if (panel) panel.hidden = t !== tab;
  });

  if (tab === 'apps') {
    loadAdminApplications();
  } else if (tab === 'materials') {
    loadAdminMaterials();
  } else if (tab === 'records') {
    loadAdminRecords();
  } else if (tab === 'myrecords') {
    loadUserRecords();
  }
}

async function loadAdminApplications() {
  try {
    const res = await api('/api/admin/applications', {});
    adminApplications = res.applications || [];
    const stats = res.stats || {};
    if ($('admin-apps-badge')) $('admin-apps-badge').textContent = stats.pending ?? 0;
    if ($('apps-count-all')) $('apps-count-all').textContent = stats.total ?? adminApplications.length;
    if ($('apps-count-pending')) $('apps-count-pending').textContent = stats.pending ?? 0;
    if ($('apps-count-approved')) $('apps-count-approved').textContent = stats.approved ?? 0;
    if ($('apps-count-rejected')) $('apps-count-rejected').textContent = stats.rejected ?? 0;
    renderAdminApplications();
  } catch (err) {
    if ($('admin-apps-list')) {
      $('admin-apps-list').innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
}

function renderAdminApplications() {
  const container = $('admin-apps-list');
  if (!container) return;

  const filtered = adminApplications.filter(app => {
    if (adminFilter === 'all') return true;
    return app.status === adminFilter;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        <div class="empty-icon">📂</div>
        <h4>No ${adminFilter === 'all' ? '' : adminFilter} applications</h4>
        <p class="muted">There are no recycler verification applications matching this filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(app => {
    const card = document.createElement('div');
    card.className = 'app-review-card';
    card.id = `admin-app-card-${app.id}`;

    let statusBadgeClass = 'badge-sent';
    let statusText = 'Pending Review';
    if (app.status === 'approved') {
      statusBadgeClass = 'badge-approved';
      statusText = 'Approved & Active';
    } else if (app.status === 'rejected') {
      statusBadgeClass = 'badge-rejected';
      statusText = 'Rejected';
    }

    const createdTime = app.created_at ? new Date(app.created_at).toLocaleString() : 'N/A';
    const reviewedTime = app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : null;

    card.innerHTML = `
      <div class="app-review-header">
        <div>
          <h4 class="app-business-title">${app.business_name || 'Recycler Business'}</h4>
          <span class="app-applicant-sub">Applicant: <strong>${app.applicant_name}</strong> (${app.applicant_email}) · Area: <strong>${app.area || app.user_area || 'N/A'}</strong></span>
        </div>
        <span class="badge ${statusBadgeClass}">${statusText}</span>
      </div>

      <div class="app-details-grid">
        <div class="app-detail-item">
          <span class="app-detail-label">Contact Phone</span>
          <span class="app-detail-value">${app.contact_phone || 'N/A'}</span>
        </div>
        <div class="app-detail-item">
          <span class="app-detail-label">Yard / Business Address</span>
          <span class="app-detail-value">${app.business_address || 'N/A'}</span>
        </div>
        <div class="app-detail-item">
          <span class="app-detail-label">Government ID</span>
          <span class="app-detail-value">${app.gov_id_type || 'ID'}: <strong>${app.gov_id_number || 'N/A'}</strong></span>
        </div>
        <div class="app-detail-item">
          <span class="app-detail-label">Licence / Registration</span>
          <span class="app-detail-value">${app.licence_type || 'Licence'}: <strong>${app.licence_number || 'N/A'}</strong></span>
        </div>
      </div>

      <div class="app-docs-box">
        <span class="app-detail-label">Submitted Verification Files</span>
        <div class="app-docs-grid">
          <div class="doc-badge">🪪 ID Document: ${app.gov_id_file ? (app.gov_id_file.startsWith('data:') ? '<a href="' + app.gov_id_file + '" target="_blank" download="gov_id">View / Download</a>' : '✓ Attached') : 'None'}</div>
          <div class="doc-badge">📷 Recycler Photo: ${app.photo_file ? (app.photo_file.startsWith('data:') ? '<a href="' + app.photo_file + '" target="_blank" download="photo">View / Download</a>' : '✓ Attached') : 'None'}</div>
          <div class="doc-badge">📜 Licence / Permit: ${app.licence_file ? (app.licence_file.startsWith('data:') ? '<a href="' + app.licence_file + '" target="_blank" download="licence">View / Download</a>' : '✓ Attached') : 'None'}</div>
        </div>
      </div>

      ${app.admin_note ? `
        <div style="background: #fffdf5; border: 1px solid #f2e2be; border-radius: 6px; padding: 8px 12px; font-size: 13px; margin-bottom: 12px;">
          <strong>Admin Note:</strong> ${app.admin_note} ${reviewedTime ? `<span class="muted">(${reviewedTime})</span>` : ''}
        </div>
      ` : ''}

      <div class="review-actions-box">
        <label for="admin-note-${app.id}" class="app-detail-label">Administrator Decision Note</label>
        <input id="admin-note-${app.id}" placeholder="${app.status === 'approved' ? 'Update review notes...' : 'Enter approval notes or specific rejection reasons...'}" style="margin-top: 4px; margin-bottom: 8px;" value="${app.admin_note || ''}">
        <div class="review-btn-row">
          <button type="button" class="btn-pill btn-approve admin-btn-approve" data-id="${app.id}">✓ ${app.status === 'approved' ? 'Re-Approve Profile' : 'Approve Recycler'}</button>
          <button type="button" class="btn-pill btn-reject admin-btn-reject" data-id="${app.id}">✕ ${app.status === 'rejected' ? 'Update Rejection Note' : 'Reject Application'}</button>
          <span class="muted" style="font-size: 12px; margin-left: auto;">Submitted ${createdTime}</span>
        </div>
      </div>
    `;

    card.querySelector('.admin-btn-approve').addEventListener('click', () => {
      const note = card.querySelector(`#admin-note-${app.id}`).value.trim();
      handleAdminAppReview(app.id, 'approved', note);
    });

    card.querySelector('.admin-btn-reject').addEventListener('click', () => {
      const note = card.querySelector(`#admin-note-${app.id}`).value.trim();
      handleAdminAppReview(app.id, 'rejected', note);
    });

    container.appendChild(card);
  });
}

async function handleAdminAppReview(applicationId, decision, note) {
  try {
    const res = await api('/api/admin/review-application', { applicationId, decision, note });
    notice(`Application ${decision === 'approved' ? 'approved' : 'rejected'} successfully.`);
    await loadAdminApplications();
  } catch (err) {
    error(err.message || 'Could not update application review.');
  }
}

async function loadAdminMaterials() {
  try {
    const res = await api('/api/admin/materials', {});
    adminMaterials = res.materials || [];
    supportedMaterials = adminMaterials;
    renderAdminMaterials();
  } catch (err) {
    if ($('admin-materials-list')) {
      $('admin-materials-list').innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
}

function renderAdminMaterials() {
  const container = $('admin-materials-list');
  if (!container) return;

  if (adminMaterials.length === 0) {
    container.innerHTML = '<p class="muted">No supported materials configured.</p>';
    return;
  }

  container.innerHTML = '';
  adminMaterials.forEach(m => {
    const card = document.createElement('div');
    card.className = `catalogue-card ${m.active ? '' : 'inactive'}`;
    card.id = `catalogue-card-${m.id}`;

    card.innerHTML = `
      <div>
        <div class="catalogue-card-header">
          <div>
            <h5 class="catalogue-card-title">${m.name}</h5>
            <span class="muted" style="font-size: 11px; font-family: monospace;">ID: ${m.id}</span>
          </div>
          <span class="${m.active ? 'badge-active' : 'badge-inactive'}">${m.active ? 'Active' : 'Inactive'}</span>
        </div>
        <p class="catalogue-guidance">${m.guidance}</p>
        <div style="font-size: 12px; color: #3b5f50; margin-bottom: 10px;">
          <span>${m.recyclable ? '✓ Recyclable in pilot' : '⚠️ Non-recyclable / Guidance only'}</span>
        </div>
      </div>
      <div class="catalogue-actions">
        <button type="button" class="text-button-subtle btn-edit-mat" data-id="${m.id}" style="font-size: 12.5px;">Edit Guidance</button>
        <button type="button" class="text-button btn-toggle-mat" data-id="${m.id}" style="font-size: 12.5px; color: ${m.active ? '#991b1b' : '#065f46'};">
          ${m.active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    `;

    card.querySelector('.btn-edit-mat').addEventListener('click', () => {
      editingMaterialId = m.id;
      $('admin-mat-id').value = m.id;
      $('admin-mat-name').value = m.name;
      $('admin-mat-guidance').value = m.guidance;
      $('admin-mat-recyclable').checked = Boolean(m.recyclable);
      $('admin-mat-active').checked = Boolean(m.active);
      $('material-form-title').textContent = `Edit Material: ${m.name}`;
      $('admin-mat-submit-btn').textContent = 'Update Material';
      $('admin-mat-cancel-btn').hidden = false;
      $('admin-mat-name').focus();
    });

    card.querySelector('.btn-toggle-mat').addEventListener('click', async () => {
      try {
        await api('/api/admin/materials/save', {
          id: m.id,
          name: m.name,
          guidance: m.guidance,
          recyclable: m.recyclable,
          active: m.active ? 0 : 1
        });
        notice(`Material "${m.name}" ${m.active ? 'deactivated' : 'activated'}.`);
        await loadAdminMaterials();
      } catch (err) {
        error(err.message);
      }
    });

    container.appendChild(card);
  });
}

function resetMaterialForm() {
  editingMaterialId = null;
  $('admin-mat-id').value = '';
  $('admin-material-form').reset();
  $('admin-mat-recyclable').checked = true;
  $('admin-mat-active').checked = true;
  $('material-form-title').textContent = 'Add New Supported Material';
  $('admin-mat-submit-btn').textContent = 'Save Material';
  $('admin-mat-cancel-btn').hidden = true;
}

async function loadAdminRecords() {
  const query = $('admin-record-search-input')?.value.trim() || '';
  const status = $('admin-record-status-filter')?.value || '';

  try {
    const res = await api('/api/admin/records', { query, status });
    adminRecords = res.records || [];
    adminStats = res.stats || {};

    if ($('admin-stat-total')) $('admin-stat-total').textContent = adminStats.totalListings ?? adminRecords.length;
    if ($('admin-stat-completed')) $('admin-stat-completed').textContent = adminStats.completed ?? 0;
    if ($('admin-stat-active')) $('admin-stat-active').textContent = adminStats.activeOffers ?? 0;
    if ($('admin-stat-handover')) $('admin-stat-handover').textContent = adminStats.handoverCoordinated ?? 0;

    renderAdminRecordsList($('admin-records-list'), adminRecords, true);
  } catch (err) {
    if ($('admin-records-list')) {
      $('admin-records-list').innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
}

async function loadUserRecords() {
  const query = $('user-record-search-input')?.value.trim() || '';
  const status = $('user-record-status-filter')?.value || '';

  try {
    const res = await api('/api/user/records', { query, status });
    userRecords = res.records || [];
    const stats = res.stats || {};

    if ($('user-records-heading')) {
      $('user-records-heading').textContent = currentUser?.role === 'generator'
        ? 'Your Recycling & Payout Records'
        : 'Your Sourcing & Payment Records';
    }
    if ($('user-records-subheading')) {
      $('user-records-subheading').textContent = currentUser?.role === 'generator'
        ? 'All your recyclable waste requests, verified buyer matches, and guaranteed ₦0 commission payouts.'
        : 'All your sourced waste listings, inspection records, and funded final offer payments.';
    }
    if ($('user-metric-label-amount')) {
      $('user-metric-label-amount').textContent = currentUser?.role === 'generator'
        ? 'Total Payouts Received (₦)'
        : 'Total Purchases Paid (₦)';
    }

    if ($('user-stat-total')) $('user-stat-total').textContent = stats.totalListings ?? userRecords.length;
    if ($('user-stat-completed')) $('user-stat-completed').textContent = stats.completed ?? 0;
    if ($('user-stat-active')) $('user-stat-active').textContent = stats.active ?? 0;
    if ($('user-stat-volume')) $('user-stat-volume').textContent = `${stats.totalVolumeKg ?? 0} kg`;
    if ($('user-stat-amount')) $('user-stat-amount').textContent = `₦${Number(stats.totalAmount ?? 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

    renderAdminRecordsList($('admin-myrecords-list'), userRecords, false);
  } catch (err) {
    if ($('admin-myrecords-list')) {
      $('admin-myrecords-list').innerHTML = `<p class="error">${err.message}</p>`;
    }
  }
}

function renderAdminRecordsList(container, records, isAdmin) {
  if (!container) return;

  if (records.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        <div class="empty-icon">📋</div>
        <h4>No transaction records found</h4>
        <p class="muted">No marketplace listings match your query.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  records.forEach(rec => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.id = `record-card-${rec.id}`;

    let statusBadgeClass = 'badge-sent';
    let statusText = rec.status;
    if (rec.status === 'completed') {
      statusBadgeClass = 'badge-approved';
      statusText = 'Completed & Paid';
    } else if (rec.status === 'funded final offer') {
      statusBadgeClass = 'badge-verified';
      statusText = 'Funded Final Offer';
    } else if (rec.status === 'declined' || rec.status === 'rejected final offer' || rec.status === 'expired') {
      statusBadgeClass = 'badge-rejected';
      statusText = rec.status === 'declined' ? 'Declined by Recycler' : (rec.status === 'rejected final offer' ? 'Final Offer Rejected' : 'Expired');
    } else if (rec.status === 'accepted' || rec.status === 'handover arranged') {
      statusBadgeClass = 'badge-approved';
      statusText = rec.status === 'handover arranged' ? 'Handover Arranged' : 'Accepted';
    }

    const createdTime = rec.created_at ? new Date(rec.created_at).toLocaleString() : 'N/A';
    const amountVal = rec.final_offer_amount ? `₦${Number(rec.final_offer_amount).toLocaleString('en-NG', { minimumFractionDigits: 2 })}` : (rec.estimated_price ? `~₦${rec.estimated_price} (${rec.price_unit || 'est'})` : '₦0.00');

    // Action button label based on status
    let actionBtnLabel = 'View Timeline & Full Details →';
    if (rec.status === 'funded final offer') {
      actionBtnLabel = currentUser?.role === 'generator' ? 'Review Final Offer & Receive Payout →' : 'View Final Offer & Decision →';
    } else if (rec.status === 'accepted' || rec.status === 'handover arranged') {
      actionBtnLabel = currentUser?.role === 'recycler' && rec.status === 'handover arranged' ? 'Record Inspection & Offer →' : 'View Handover Coordination →';
    } else if (rec.status === 'completed') {
      actionBtnLabel = 'View Receipt & Audit Trail →';
    }

    card.innerHTML = `
      <div class="record-card-header">
        <div>
          <span class="ref-pill" style="font-size: 11px;">REF: #${(rec.id || '').slice(0, 8).toUpperCase()}</span>
          <strong style="margin-left: 8px; font-size: 15px; color: #163d2f;">${rec.material_name || 'Recyclable Material'}</strong>
        </div>
        <span class="badge ${statusBadgeClass}">${statusText}</span>
      </div>

      <div class="record-parties-row">
        <div class="record-party-box">
          <span class="app-detail-label">Generator</span>
          <strong style="color: #1a4434;">${rec.generator_name || 'Generator'}</strong>
          <div class="muted" style="font-size: 12px;">${rec.generator_email || ''} · ${rec.generator_area || rec.location_address || ''}</div>
        </div>
        <div class="record-party-box">
          <span class="app-detail-label">Recycler Buyer</span>
          <strong style="color: #1a4434;">${rec.recycler_name || 'Recycler'}</strong>
          <div class="muted" style="font-size: 12px;">${rec.recycler_phone || ''} · ${rec.recycler_area || rec.recycler_yard_address || ''}</div>
        </div>
      </div>

      <div class="record-financials-row">
        <div>
          <span class="muted" style="font-size: 12px;">Quantity:</span>
          <strong>${rec.actual_quantity ? `${rec.actual_quantity} ${rec.actual_unit || 'kg'}` : (rec.declared_quantity ? `${rec.declared_quantity} ${rec.quantity_unit || 'kg'} (declared)` : 'Unstated')}</strong>
        </div>
        <div>
          <span class="muted" style="font-size: 12px;">Financial Value:</span>
          <strong style="color: #134e35;">${amountVal}</strong>
        </div>
        <div>
          <span class="commission-free" style="font-size: 12px;">₦0 Commission (Pilot)</span>
        </div>
      </div>

      ${rec.payment_ref ? `
        <div style="background: #f4faf6; border: 1px solid #cbe9d7; border-radius: 6px; padding: 6px 10px; font-size: 12px; margin-bottom: 8px; display: flex; justify-content: space-between;">
          <span><strong>Payment Reference:</strong> <code style="font-family: monospace; color: #14532d;">${rec.payment_ref}</code></span>
          <span class="badge badge-approved" style="font-size: 10.5px;">✓ Released</span>
        </div>
      ` : ''}

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; flex-wrap: wrap; gap: 8px;">
        <span class="muted" style="font-size: 11.5px;">Created: ${createdTime} · Arrangement: ${rec.preferred_arrangement === 'pickup' ? '🚚 Pickup' : '📍 Drop-off'}</span>
        <div style="display: flex; gap: 8px;">
          <button type="button" class="text-button-subtle btn-toggle-drawer" data-id="${rec.id}" style="font-size: 12px;">Milestones ▼</button>
          <button type="button" class="text-button btn-view-full-audit" data-id="${rec.id}" style="font-size: 12.5px;">${actionBtnLabel}</button>
        </div>
      </div>

      <!-- Expandable In-Place Milestone Timeline Drawer -->
      <div class="record-audit-drawer" id="drawer-${rec.id}" hidden>
        <h5>
          <span>Lifecycle Milestones &amp; Audit Trail</span>
          <button type="button" class="text-button-subtle btn-close-drawer" data-id="${rec.id}" style="font-size: 11px;">Close ▲</button>
        </h5>
        <div class="timeline-mini" id="timeline-mini-${rec.id}">
          <p class="muted" style="font-size: 12px;">Loading milestone events…</p>
        </div>
      </div>
    `;

    card.querySelector('.btn-view-full-audit').addEventListener('click', () => {
      if (['handover arranged', 'funded final offer', 'completed', 'offer rejected', 'expired'].includes(rec.status)) {
        showInspectionScreen7(rec.id);
      } else {
        showListingScreen6(rec.id);
      }
    });

    const toggleBtn = card.querySelector('.btn-toggle-drawer');
    const closeBtn = card.querySelector('.btn-close-drawer');
    const drawer = card.querySelector(`#drawer-${rec.id}`);
    const timelineContainer = card.querySelector(`#timeline-mini-${rec.id}`);

    async function toggleDrawer() {
      const isHidden = drawer.hidden;
      drawer.hidden = !isHidden;
      toggleBtn.textContent = isHidden ? 'Milestones ▲' : 'Milestones ▼';
      if (isHidden) {
        try {
          const details = await api('/api/user/record-details', { listingId: rec.id });
          const events = details.events || [];
          if (events.length === 0) {
            timelineContainer.innerHTML = '<p class="muted" style="font-size: 12px;">No events recorded.</p>';
            return;
          }
          timelineContainer.innerHTML = '';
          events.forEach(ev => {
            const timeStr = ev.created_at ? new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const dateStr = ev.created_at ? new Date(ev.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
            const item = document.createElement('div');
            item.className = 'timeline-mini-item';
            item.innerHTML = `
              <span class="timeline-mini-time">${dateStr} ${timeStr}</span>
              <div class="timeline-mini-content">
                <strong>${ev.event_type.replace(/_/g, ' ')}:</strong> ${ev.event_note || ''}
              </div>
            `;
            timelineContainer.appendChild(item);
          });
        } catch (e) {
          timelineContainer.innerHTML = `<p class="error" style="font-size: 12px;">${e.message}</p>`;
        }
      }
    }

    toggleBtn.addEventListener('click', toggleDrawer);
    closeBtn.addEventListener('click', toggleDrawer);

    container.appendChild(card);
  });
}

// Screen 8 Event Listeners
if ($('header-admin-btn')) {
  $('header-admin-btn').addEventListener('click', () => showAdminScreen8('apps'));
}
if ($('header-records-btn')) {
  $('header-records-btn').addEventListener('click', () => showAdminScreen8('myrecords'));
}
if ($('admin-close-btn')) {
  $('admin-close-btn').addEventListener('click', () => {
    if (currentUser?.role === 'administrator') {
      switchAdminTab('apps');
    } else if (currentUser?.role === 'recycler') {
      if (currentUser.accountStatus === 'active' || currentUser.accountStatus === 'approved') {
        showRecyclerScreen4(currentUser);
      } else {
        showRecyclerScreen2(currentUser, recyclerApp);
      }
    } else if (currentUser?.role === 'generator') {
      showGeneratorScreen3(currentUser);
    } else {
      switchAuthTab(activeAuthTab);
    }
  });
}
if ($('screen8-back-btn')) {
  $('screen8-back-btn').addEventListener('click', () => {
    if (currentUser?.role === 'recycler') {
      if (currentUser.accountStatus === 'active' || currentUser.accountStatus === 'approved') {
        showRecyclerScreen4(currentUser);
      } else {
        showRecyclerScreen2(currentUser, recyclerApp);
      }
    } else if (currentUser?.role === 'generator') {
      showGeneratorScreen3(currentUser);
    } else {
      switchAuthTab(activeAuthTab);
    }
  });
}

if ($('admin-tab-apps')) $('admin-tab-apps').addEventListener('click', () => switchAdminTab('apps'));
if ($('admin-tab-materials')) $('admin-tab-materials').addEventListener('click', () => switchAdminTab('materials'));
if ($('admin-tab-records')) $('admin-tab-records').addEventListener('click', () => switchAdminTab('records'));
if ($('admin-tab-myrecords')) $('admin-tab-myrecords').addEventListener('click', () => switchAdminTab('myrecords'));

// Filter buttons
if ($('admin-apps-filter-group')) {
  $('admin-apps-filter-group').addEventListener('click', e => {
    const btn = e.target.closest('.filter-pill');
    if (!btn) return;
    $('admin-apps-filter-group').querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    adminFilter = btn.dataset.filter || 'all';
    renderAdminApplications();
  });
}

// Material Form
if ($('admin-material-form')) {
  $('admin-material-form').addEventListener('submit', event => {
    event.preventDefault();
    const id = $('admin-mat-id').value.trim();
    const name = $('admin-mat-name').value.trim();
    const guidance = $('admin-mat-guidance').value.trim();
    const recyclable = $('admin-mat-recyclable').checked ? 1 : 0;
    const active = $('admin-mat-active').checked ? 1 : 0;

    perform($('admin-mat-submit-btn'), 'Saving material…', async () => {
      await api('/api/admin/materials/save', { id, name, guidance, recyclable, active });
      notice(`Material "${name}" saved to pilot catalogue.`);
      resetMaterialForm();
      await loadAdminMaterials();
    });
  });
}
if ($('admin-mat-cancel-btn')) {
  $('admin-mat-cancel-btn').addEventListener('click', resetMaterialForm);
}

// Admin Records Search & Refresh
if ($('admin-record-refresh-btn')) {
  $('admin-record-refresh-btn').addEventListener('click', loadAdminRecords);
}
if ($('admin-record-search-input')) {
  $('admin-record-search-input').addEventListener('input', loadAdminRecords);
}
if ($('admin-record-status-filter')) {
  $('admin-record-status-filter').addEventListener('change', loadAdminRecords);
}

// User Personal Records Search & Filter
if ($('user-record-refresh-btn')) {
  $('user-record-refresh-btn').addEventListener('click', loadUserRecords);
}
if ($('user-record-search-input')) {
  $('user-record-search-input').addEventListener('input', loadUserRecords);
}
if ($('user-record-status-filter')) {
  $('user-record-status-filter').addEventListener('change', loadUserRecords);
}

// View records button on Screen 4 and Screen 3
if ($('view-records-btn')) {
  $('view-records-btn').disabled = false;
  $('view-records-btn').addEventListener('click', () => showAdminScreen8('myrecords'));
}
if ($('gen-view-records-btn')) {
  $('gen-view-records-btn').addEventListener('click', () => showAdminScreen8('myrecords'));
}

// Sign Out Handlers
async function handleSignOut() {
  await api('/api/logout', {});
  location.reload();
}
if ($('logout')) $('logout').addEventListener('click', () => perform($('logout'), 'Signing out…', handleSignOut));
if ($('gen-logout-btn')) $('gen-logout-btn').addEventListener('click', () => perform($('gen-logout-btn'), 'Signing out…', handleSignOut));
if ($('screen5-logout-btn')) $('screen5-logout-btn').addEventListener('click', () => perform($('screen5-logout-btn'), 'Signing out…', handleSignOut));
if ($('screen6-logout-btn')) $('screen6-logout-btn').addEventListener('click', () => perform($('screen6-logout-btn'), 'Signing out…', handleSignOut));
if ($('header-logout')) $('header-logout').addEventListener('click', () => perform($('header-logout'), 'Signing out…', handleSignOut));
if ($('dash-logout-btn')) $('dash-logout-btn').addEventListener('click', () => perform($('dash-logout-btn'), 'Signing out…', handleSignOut));

// ----------------------------------------------------
// WALLET & BANK ACCOUNTS LOGIC
// ----------------------------------------------------
function formatNaira(amount) {
  const num = Number(amount || 0);
  return '₦' + num.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderWalletCards() {
  if (!currentUser) return;

  if (currentUser.role === 'generator') {
    const card = $('gen-wallet-card');
    if (card) {
      card.hidden = false;
      const bal = currentWallet ? currentWallet.available_balance : 0;
      if ($('gen-wallet-balance')) {
        $('gen-wallet-balance').textContent = Number(bal || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      if ($('gen-wallet-lifetime')) {
        $('gen-wallet-lifetime').textContent = `Total Earned: ${formatNaira(lifetimeTotal)}`;
      }
      if ($('btn-gen-bank-setup')) {
        if (savedBankAccount && savedBankAccount.account_number) {
          const last4 = savedBankAccount.account_number.slice(-4);
          $('btn-gen-bank-setup').textContent = `🏦 ${savedBankAccount.bank_name || 'Bank'} (••${last4})`;
        } else {
          $('btn-gen-bank-setup').textContent = '🏦 Link Bank Account';
        }
      }
    }
  } else if (currentUser.role === 'recycler') {
    const card = $('rec-wallet-card');
    if (card) {
      card.hidden = false;
      const bal = currentWallet ? currentWallet.available_balance : 0;
      const escrow = currentWallet ? currentWallet.escrow_locked_balance : 0;
      if ($('rec-wallet-balance')) {
        $('rec-wallet-balance').textContent = Number(bal || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      if ($('rec-wallet-escrow')) {
        $('rec-wallet-escrow').textContent = `🔒 ${formatNaira(escrow)} in Escrow`;
      }
      if ($('rec-wallet-lifetime')) {
        $('rec-wallet-lifetime').textContent = `Total Spent: ${formatNaira(lifetimeTotal)}`;
      }
      if ($('btn-rec-bank-setup')) {
        if (savedBankAccount && savedBankAccount.account_number) {
          const last4 = savedBankAccount.account_number.slice(-4);
          $('btn-rec-bank-setup').textContent = `🏦 ${savedBankAccount.bank_name || 'Bank'} (••${last4})`;
        } else {
          $('btn-rec-bank-setup').textContent = '🏦 Link Bank Details';
        }
      }
    }
  }
}

// Modal Open/Close Controls
function openTopupModal() {
  error('');
  notice('');
  const modal = $('wallet-topup-modal');
  if (!modal) return;
  if ($('topup-amount-input')) $('topup-amount-input').value = '';
  const firstRadio = document.querySelector('input[name="topupChannel"][value="instant_transfer"]');
  if (firstRadio) firstRadio.checked = true;
  if ($('virtual-acct-box')) $('virtual-acct-box').hidden = true;
  if ($('v-acct-beneficiary')) $('v-acct-beneficiary').textContent = currentUser ? currentUser.name : 'Your Business';
  modal.hidden = false;
  $('topup-amount-input')?.focus();
}

function closeTopupModal() {
  const modal = $('wallet-topup-modal');
  if (modal) modal.hidden = true;
}

function openBankModal() {
  error('');
  notice('');
  const modal = $('wallet-bank-modal');
  if (!modal) return;
  
  if (savedBankAccount) {
    if ($('bank-code-select')) $('bank-code-select').value = savedBankAccount.bank_code || '';
    if ($('bank-account-num')) $('bank-account-num').value = savedBankAccount.account_number || '';
    if ($('bank-account-name')) $('bank-account-name').value = savedBankAccount.account_name || '';
    if ($('bank-verified-indicator')) $('bank-verified-indicator').hidden = false;
  } else {
    if ($('bank-code-select')) $('bank-code-select').value = '';
    if ($('bank-account-num')) $('bank-account-num').value = '';
    if ($('bank-account-name')) $('bank-account-name').value = currentUser ? currentUser.name.toUpperCase() : '';
    if ($('bank-verified-indicator')) $('bank-verified-indicator').hidden = true;
  }
  modal.hidden = false;
  $('bank-code-select')?.focus();
}

function closeBankModal() {
  const modal = $('wallet-bank-modal');
  if (modal) modal.hidden = true;
}

function openWithdrawModal() {
  error('');
  notice('');
  const modal = $('wallet-withdraw-modal');
  if (!modal) return;

  const avail = currentWallet ? currentWallet.available_balance : 0;
  if ($('withdraw-modal-avail-balance')) {
    $('withdraw-modal-avail-balance').textContent = formatNaira(avail);
  }
  if ($('withdraw-amount-input')) {
    $('withdraw-amount-input').value = '';
    $('withdraw-amount-input').max = String(avail);
  }

  if (savedBankAccount && savedBankAccount.account_number) {
    if ($('withdraw-dest-bank-name')) $('withdraw-dest-bank-name').textContent = savedBankAccount.bank_name;
    if ($('withdraw-dest-acct-num')) {
      $('withdraw-dest-acct-num').textContent = `${savedBankAccount.account_number} • ${savedBankAccount.account_name}`;
    }
  } else {
    if ($('withdraw-dest-bank-name')) $('withdraw-dest-bank-name').textContent = 'No bank account linked';
    if ($('withdraw-dest-acct-num')) {
      $('withdraw-dest-acct-num').textContent = 'Please link your bank account before withdrawing';
    }
  }
  modal.hidden = false;
  $('withdraw-amount-input')?.focus();
}

function closeWithdrawModal() {
  const modal = $('wallet-withdraw-modal');
  if (modal) modal.hidden = true;
}

// Wallet Event Listeners
if ($('btn-rec-topup')) {
  $('btn-rec-topup').addEventListener('click', openTopupModal);
}
if ($('btn-close-topup-modal')) {
  $('btn-close-topup-modal').addEventListener('click', closeTopupModal);
}
if ($('wallet-topup-modal')) {
  $('wallet-topup-modal').addEventListener('click', e => {
    if (e.target === $('wallet-topup-modal')) closeTopupModal();
  });
}

// Topup preset chips
document.querySelectorAll('.preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const amt = chip.getAttribute('data-amount');
    if (amt && $('topup-amount-input')) {
      $('topup-amount-input').value = amt;
    }
  });
});

if ($('topup-amount-input')) {
  $('topup-amount-input').addEventListener('input', () => {
    document.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
  });
}

// Topup channel toggle
document.querySelectorAll('input[name="topupChannel"]').forEach(radio => {
  radio.addEventListener('change', () => {
    if ($('virtual-acct-box')) {
      $('virtual-acct-box').hidden = radio.value !== 'virtual_account';
    }
  });
});

// Submit top-up form
if ($('wallet-topup-form')) {
  $('wallet-topup-form').addEventListener('submit', event => {
    event.preventDefault();
    const amtInput = $('topup-amount-input');
    const amount = Number(amtInput?.value || 0);
    if (!amount || amount < 100) {
      error('Please enter a minimum top-up amount of ₦100.');
      return;
    }
    const channel = document.querySelector('input[name="topupChannel"]:checked')?.value || 'instant_transfer';
    perform($('btn-submit-topup'), 'Processing top-up…', async () => {
      const res = await api('/api/wallet/topup', { amount, channel });
      if (res.wallet) currentWallet = res.wallet;
      if (res.transactions) walletTransactions = res.transactions;
      if (res.lifetimeTotal !== undefined) lifetimeTotal = res.lifetimeTotal;
      renderWalletCards();
      closeTopupModal();
      notice(`Successfully topped up ${formatNaira(amount)}! Your trading balance is updated.`);
    });
  });
}

// Bank Account Modal
if ($('btn-gen-bank-setup')) {
  $('btn-gen-bank-setup').addEventListener('click', openBankModal);
}
if ($('btn-rec-bank-setup')) {
  $('btn-rec-bank-setup').addEventListener('click', openBankModal);
}
if ($('btn-close-bank-modal')) {
  $('btn-close-bank-modal').addEventListener('click', closeBankModal);
}
if ($('wallet-bank-modal')) {
  $('wallet-bank-modal').addEventListener('click', e => {
    if (e.target === $('wallet-bank-modal')) closeBankModal();
  });
}
if ($('btn-withdraw-change-bank')) {
  $('btn-withdraw-change-bank').addEventListener('click', () => {
    closeWithdrawModal();
    openBankModal();
  });
}

// Bank account auto-verification on 10 digits
if ($('bank-account-num')) {
  $('bank-account-num').addEventListener('input', e => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 10);
    e.target.value = val;
    if (val.length === 10) {
      if ($('bank-account-name')) {
        $('bank-account-name').value = (currentUser?.name || 'VERIFIED USER').toUpperCase();
      }
      if ($('bank-verified-indicator')) {
        $('bank-verified-indicator').hidden = false;
      }
    } else {
      if ($('bank-verified-indicator')) {
        $('bank-verified-indicator').hidden = true;
      }
    }
  });
}

// Submit bank account form
if ($('wallet-bank-form')) {
  $('wallet-bank-form').addEventListener('submit', event => {
    event.preventDefault();
    const bankSelect = $('bank-code-select');
    const bankCode = bankSelect?.value;
    const bankName = bankSelect?.selectedOptions[0]?.getAttribute('data-name') || bankSelect?.selectedOptions[0]?.textContent || '';
    const accountNumber = $('bank-account-num')?.value.trim();
    const accountName = $('bank-account-name')?.value.trim() || (currentUser?.name || '').toUpperCase();

    if (!bankCode) {
      error('Please select your bank.');
      return;
    }
    if (!accountNumber || accountNumber.length !== 10) {
      error('Please enter a valid 10-digit NUBAN account number.');
      return;
    }

    perform($('btn-save-bank-account'), 'Verifying & saving bank…', async () => {
      const res = await api('/api/wallet/bank-account', {
        bankCode,
        bankName,
        accountNumber,
        accountName
      });
      if (res.bankAccount) savedBankAccount = res.bankAccount;
      renderWalletCards();
      closeBankModal();
      notice(`Bank account (${bankName} - ${accountNumber}) saved and verified!`);
    });
  });
}

// Withdraw Modal & Handlers
if ($('btn-gen-withdraw')) {
  $('btn-gen-withdraw').addEventListener('click', () => {
    if (!savedBankAccount) {
      notice('Please link your bank account first so we know where to send your funds.');
      openBankModal();
    } else {
      openWithdrawModal();
    }
  });
}
if ($('btn-close-withdraw-modal')) {
  $('btn-close-withdraw-modal').addEventListener('click', closeWithdrawModal);
}
if ($('wallet-withdraw-modal')) {
  $('wallet-withdraw-modal').addEventListener('click', e => {
    if (e.target === $('wallet-withdraw-modal')) closeWithdrawModal();
  });
}

// Withdraw preset chips
document.querySelectorAll('.preset-withdraw-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.preset-withdraw-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const amt = chip.getAttribute('data-amount');
    const avail = currentWallet ? currentWallet.available_balance : 0;
    if ($('withdraw-amount-input')) {
      if (amt === 'all') {
        $('withdraw-amount-input').value = avail > 0 ? avail : '';
      } else {
        $('withdraw-amount-input').value = amt;
      }
    }
  });
});

if ($('withdraw-amount-input')) {
  $('withdraw-amount-input').addEventListener('input', () => {
    document.querySelectorAll('.preset-withdraw-chip').forEach(c => c.classList.remove('active'));
  });
}

// Global modal escape key listener
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeScannerModal?.();
    closeTopupModal?.();
    closeBankModal?.();
    closeWithdrawModal?.();
  }
});

// Submit withdrawal form
if ($('wallet-withdraw-form')) {
  $('wallet-withdraw-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!savedBankAccount) {
      error('Please link your bank account before cashing out.');
      closeWithdrawModal();
      openBankModal();
      return;
    }

    const avail = currentWallet ? currentWallet.available_balance : 0;
    const amount = Number($('withdraw-amount-input')?.value || 0);

    if (!amount || amount <= 0) {
      error('Please enter a valid withdrawal amount.');
      return;
    }
    if (amount > avail) {
      error(`Insufficient funds. Your available balance is ${formatNaira(avail)}.`);
      return;
    }

    perform($('btn-submit-withdrawal'), 'Processing instant withdrawal…', async () => {
      const res = await api('/api/wallet/withdraw', { amount });
      if (res.wallet) currentWallet = res.wallet;
      if (res.transactions) walletTransactions = res.transactions;
      renderWalletCards();
      closeWithdrawModal();
      notice(`💸 Cash-out of ${formatNaira(amount)} sent to ${savedBankAccount.bank_name} (${savedBankAccount.account_number})!`);
    });
  });
}

setInterval(cooldown, 1000);

// Live state polling every 4 seconds to sync status changes seamlessly across tabs
setInterval(async () => {
  if (!currentUser || busy) return;
  try {
    const state = await api('/api/state');
    if (state && state.user) {
      if (state.wallet) currentWallet = state.wallet;
      if (state.bankAccount) savedBankAccount = state.bankAccount;
      if (state.walletTransactions) walletTransactions = state.walletTransactions;
      if (state.lifetimeTotal !== undefined) lifetimeTotal = state.lifetimeTotal;
      renderWalletCards();

      if (currentUser.role === 'generator') {
        generatorListings = state.listings || [];
        renderGeneratorListings();
      } else if (currentUser.role === 'recycler') {
        incomingRequests = state.incomingRequests || [];
        renderRecyclerIncomingRequests();
      }
    }
  } catch {}
}, 4000);

async function initialize() {
  busy = true;
  document.querySelectorAll('button').forEach(x => x.disabled = true);
  try {
    const state = await api('/api/state');
    routeUser(state.user, state);
    if (!state.emailConfigured && !state.user) {
      notice('Email verification is not available yet. Please try again later.');
    }
  } catch {
    error('Could not connect to EcoSmart. Refresh the page to try again.');
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(x => x.disabled = false);
    cooldown();
  }
}

initialize();
