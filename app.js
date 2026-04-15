// ===== Supabase 設定 =====
const SUPABASE_URL = 'https://ioftnuhttlzkcbxlnsvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZnRudWh0dGx6a2NieGxuc3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMzIwNDcsImV4cCI6MjA5MTgwODA0N30.d4JzELooUvKMwxMgbZPBV5TxsVAR1kVOSEME_jFwJ2o';

// ===== 密碼設定 =====
const PASSWORDS = {
  super: 'admin1234',
  offices: {
    '新北': 'nb001',
    '桃園': 'ty001',
    '新竹': 'hc001',
    '宜蘭': 'yl001',
  }
};

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 狀態 =====
let offices = [];
let vehicles = [];
let bookings = [];
let blockedSlots = [];
let allBookings = [];
let selectedOfficeId = null;
let selectedOfficeName = null;
let selectedVehicleId = null;
let selectedDate = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let adminLevel = null;
let realtimeChannel = null;

// ===== 初始化 =====
async function init() {
  await loadOffices();
  setupEventListeners();
  showOfficePicker();
}

// ===== 載入辦公室 =====
async function loadOffices() {
  const { data, error } = await db.from('offices').select('*').order('name');
  if (error) { showToast('載入辦公室失敗', 'error'); return; }
  offices = data;
}

// ===== 顯示辦公室選擇畫面 =====
function showOfficePicker() {
  document.getElementById('officePicker').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
  const grid = document.getElementById('officePickerGrid');
  grid.innerHTML = offices.map(o => `
    <button class="office-pick-btn" data-id="${o.id}" data-name="${o.name}">${o.name}</button>
  `).join('');
  grid.querySelectorAll('.office-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => enterOffice(btn.dataset.id, btn.dataset.name));
  });
}

// ===== 進入辦公室 =====
async function enterOffice(id, name) {
  selectedOfficeId = id;
  selectedOfficeName = name;
  adminLevel = null;
  document.getElementById('officePicker').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('currentOfficeName').textContent = name;
  updateAdminBtn();
  await loadVehicles(id);
  await loadAllBookings(id);
}

// ===== 載入車輛 =====
async function loadVehicles(officeId) {
  const { data, error } = await db.from('vehicles').select('*').eq('office_id', officeId).order('name');
  if (error) { showToast('載入車輛失敗', 'error'); return; }
  vehicles = data;
  renderVehicleTabs();
  if (vehicles.length > 0) selectVehicle(vehicles[0].id);
  else { selectedVehicleId = null; bookings = []; blockedSlots = []; renderCalendar(); }
}

// ===== 載入預約與封鎖（月曆用）=====
async function loadBookingsAndBlocked() {
  if (!selectedVehicleId) return;
  const startDate = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];
  const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];
  const [b, bl] = await Promise.all([
    db.from('bookings').select('*').eq('vehicle_id', selectedVehicleId).gte('date', startDate).lte('date', endDate),
    db.from('blocked_slots').select('*').eq('vehicle_id', selectedVehicleId).gte('date', startDate).lte('date', endDate)
  ]);
  bookings = b.data || [];
  blockedSlots = bl.data || [];
  renderCalendar();
  if (selectedDate) renderSidebarContent();
}

// ===== 載入所有登記紀錄（列表用）=====
async function loadAllBookings(officeId) {
  const vehicleIds = vehicles.map(v => v.id);
  if (vehicleIds.length === 0) { allBookings = []; renderBookingLog(); return; }
  const { data, error } = await db
    .from('bookings')
    .select('*, vehicles(name, plate)')
    .in('vehicle_id', vehicleIds)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) return;
  allBookings = data || [];
  renderBookingLog();
}

// ===== Realtime 訂閱 =====
function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db
    .channel('car-booking-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
      loadBookingsAndBlocked();
      loadAllBookings(selectedOfficeId);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, () => {
      loadBookingsAndBlocked();
    })
    .subscribe();
}

// ===== 選擇車輛 =====
function selectVehicle(id) {
  selectedVehicleId = id;
  document.querySelectorAll('.vehicle-tab').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  subscribeRealtime();
  loadBookingsAndBlocked();
}

// ===== 渲染車輛標籤 =====
function renderVehicleTabs() {
  const el = document.getElementById('vehicleTabs');
  if (vehicles.length === 0) {
    el.innerHTML = '<span style="color:var(--text3);font-size:13px;">此辦公室尚無車輛</span>';
    return;
  }
  el.innerHTML = vehicles.map(v => `
    <button class="vehicle-tab" data-id="${v.id}">
      <span>${v.name || '未命名'}</span>
      <span class="vehicle-plate">${v.plate}</span>
    </button>
  `).join('');
  el.querySelectorAll('.vehicle-tab').forEach(btn => {
    btn.addEventListener('click', () => selectVehicle(btn.dataset.id));
  });
}

// ===== 渲染月曆 =====
function renderCalendar() {
  const title = document.getElementById('calendarTitle');
  title.textContent = `${currentYear} 年 ${currentMonth + 1} 月`;
  const grid = document.getElementById('calendarGrid');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  let html = weekdays.map(d => `<div class="calendar-weekday">${d}</div>`).join('');
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date();
  for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === d;
    const isPast = new Date(currentYear, currentMonth, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayBookings = bookings.filter(b => b.date === dateStr);
    const dayBlocked = blockedSlots.filter(b => b.date === dateStr);
    const status = getDayStatus(dayBookings, dayBlocked);
    let dotHtml = '';
    if (status === 'blocked') dotHtml = `<span class="dot-small blocked"></span>`;
    else if (status === 'full') dotHtml = `<span class="dot-small full"></span>`;
    else if (status === 'partial') dotHtml = `<span class="dot-small partial"></span>`;
    else if (!isPast) dotHtml = `<span class="dot-small available"></span>`;
    html += `
      <div class="calendar-day ${isToday ? 'today' : ''} ${isPast ? 'past' : ''}" data-date="${dateStr}">
        <span class="day-num">${d}</span>
        <div class="day-dots">${dotHtml}</div>
      </div>
    `;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.calendar-day:not(.empty):not(.past)').forEach(el => {
    el.addEventListener('click', () => openSidebar(el.dataset.date));
  });
}

// ===== 計算日期狀態 =====
function getDayStatus(dayBookings, dayBlocked) {
  if (dayBlocked.some(b => b.period === 'full')) return 'blocked';
  const blockedMorning = dayBlocked.some(b => b.period === 'morning');
  const blockedAfternoon = dayBlocked.some(b => b.period === 'afternoon');
  if (blockedMorning && blockedAfternoon) return 'blocked';
  const bookedFull = dayBookings.some(b => b.period === 'full');
  const bookedMorning = dayBookings.some(b => b.period === 'morning');
  const bookedAfternoon = dayBookings.some(b => b.period === 'afternoon');
  if (bookedFull || (bookedMorning && bookedAfternoon)) return 'full';
  if (bookedMorning || bookedAfternoon || dayBookings.length > 0) return 'partial';
  if (blockedMorning || blockedAfternoon) return 'partial';
  return 'available';
}

// ===== 開啟側邊欄 =====
function openSidebar(dateStr) {
  if (!selectedVehicleId) { showToast('請先選擇車輛', 'error'); return; }
  selectedDate = dateStr;
  const [y, m, d] = dateStr.split('-');
  document.getElementById('sidebarDate').textContent = `${y} 年 ${parseInt(m)} 月 ${parseInt(d)} 日`;
  renderSidebarContent();
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}

// ===== 關閉側邊欄 =====
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  selectedDate = null;
}

// ===== 渲染側邊欄內容 =====
function renderSidebarContent() {
  const dayBookings = bookings.filter(b => b.date === selectedDate);
  const dayBlocked = blockedSlots.filter(b => b.date === selectedDate);
  const bookingList = document.getElementById('bookingList');
  let html = '';
  dayBlocked.forEach(bl => {
    html += `
      <div class="booking-item blocked-item">
        <div class="booking-info">
          <div class="booking-period">🔒 封鎖：${periodLabel(bl.period, bl.start_time, bl.end_time)}</div>
          <div class="booking-name">${bl.reason || '（無說明）'}</div>
        </div>
        ${adminLevel ? `<button class="booking-delete" data-id="${bl.id}" data-type="blocked">✕</button>` : ''}
      </div>
    `;
  });
  dayBookings.forEach(bk => {
    html += `
      <div class="booking-item">
        <div class="booking-info">
          <div class="booking-period">${periodLabel(bk.period, bk.start_time, bk.end_time)}</div>
          <div class="booking-name">${bk.user_name}</div>
          <div class="booking-purpose">${bk.purpose}</div>
        </div>
        ${adminLevel ? `<button class="booking-delete" data-id="${bk.id}" data-type="booking">✕</button>` : ''}
      </div>
    `;
  });
  if (!html) html = '<div class="empty-state">此日期尚無預約</div>';
  bookingList.innerHTML = html;
  bookingList.querySelectorAll('.booking-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteRecord(btn.dataset.id, btn.dataset.type));
  });
  document.getElementById('adminSection').style.display = adminLevel ? 'flex' : 'none';
  renderBookingForm(dayBookings, dayBlocked);
}

// ===== 渲染預約表單（根據已佔用時段調整）=====
function renderBookingForm(dayBookings, dayBlocked) {
  const all = [...dayBookings, ...dayBlocked];
  const bookedFull = all.some(b => b.period === 'full');
  const bookedMorning = all.some(b => b.period === 'morning');
  const bookedAfternoon = all.some(b => b.period === 'afternoon');
  document.querySelectorAll('input[name="period"]').forEach(input => {
    const opt = input.closest('.period-opt');
    let disabled = false;
    if (input.value === 'full' && (bookedFull || bookedMorning || bookedAfternoon)) disabled = true;
    if (input.value === 'morning' && (bookedFull || bookedMorning)) disabled = true;
    if (input.value === 'afternoon' && (bookedFull || bookedAfternoon)) disabled = true;
    input.disabled = disabled;
    opt.style.opacity = disabled ? '0.4' : '1';
    opt.style.pointerEvents = disabled ? 'none' : 'auto';
    if (disabled) input.checked = false;
  });
}

// ===== 時段標籤 =====
function periodLabel(period, start, end) {
  if (period === 'full') return '整天';
  if (period === 'morning') return '上午';
  if (period === 'afternoon') return '下午';
  if (period === 'custom') return `${(start||'').slice(0,5)} — ${(end||'').slice(0,5)}`;
  return period;
}

// ===== 衝突檢查 =====
function hasConflict(period, dayBookings, dayBlocked) {
  const all = [...dayBookings, ...dayBlocked];
  const hasFull = all.some(b => b.period === 'full');
  const hasMorning = all.some(b => b.period === 'morning');
  const hasAfternoon = all.some(b => b.period === 'afternoon');
  if (period === 'full' && (hasFull || hasMorning || hasAfternoon)) return true;
  if (period === 'morning' && (hasFull || hasMorning)) return true;
  if (period === 'afternoon' && (hasFull || hasAfternoon)) return true;
  return false;
}

// ===== 新增預約 =====
async function submitBooking() {
  const period = document.querySelector('input[name="period"]:checked')?.value;
  const userName = document.getElementById('userName').value.trim();
  const purpose = document.getElementById('userPurpose').value.trim();
  const startTime = document.getElementById('startTime').value;
  const endTime = document.getElementById('endTime').value;
  if (!period) { showToast('請選擇時段', 'error'); return; }
  if (!userName) { showToast('請輸入姓名', 'error'); return; }
  if (!purpose) { showToast('請輸入用途', 'error'); return; }
  if (period === 'custom' && (!startTime || !endTime)) { showToast('請輸入自訂時間', 'error'); return; }
  const dayBookings = bookings.filter(b => b.date === selectedDate);
  const dayBlocked = blockedSlots.filter(b => b.date === selectedDate);
  if (hasConflict(period, dayBookings, dayBlocked)) {
    showToast('此時段已被預約或封鎖', 'error'); return;
  }
  const { error } = await db.from('bookings').insert({
    vehicle_id: selectedVehicleId,
    date: selectedDate,
    period,
    user_name: userName,
    purpose,
    start_time: period === 'custom' ? startTime : null,
    end_time: period === 'custom' ? endTime : null,
  });
  if (error) { showToast('預約失敗，請重試', 'error'); return; }
  showToast('預約成功！', 'success');
  document.getElementById('userName').value = '';
  document.getElementById('userPurpose').value = '';
  const checked = document.querySelector('input[name="period"]:checked');
  if (checked) checked.checked = false;
  document.getElementById('customTime').style.display = 'none';
}

// ===== 封鎖時段（管理員）=====
async function submitBlock() {
  const period = document.querySelector('input[name="blockPeriod"]:checked')?.value;
  const reason = document.getElementById('blockReason').value.trim();
  const startTime = document.getElementById('blockStartTime').value;
  const endTime = document.getElementById('blockEndTime').value;
  if (!period) { showToast('請選擇封鎖時段', 'error'); return; }
  if (period === 'custom' && (!startTime || !endTime)) { showToast('請輸入自訂時間', 'error'); return; }
  const { error } = await db.from('blocked_slots').insert({
    vehicle_id: selectedVehicleId,
    date: selectedDate,
    period,
    reason: reason || null,
    start_time: period === 'custom' ? startTime : null,
    end_time: period === 'custom' ? endTime : null,
  });
  if (error) { showToast('封鎖失敗，請重試', 'error'); return; }
  showToast('時段已封鎖', 'success');
  document.getElementById('blockReason').value = '';
  const checked = document.querySelector('input[name="blockPeriod"]:checked');
  if (checked) checked.checked = false;
  document.getElementById('blockCustomTime').style.display = 'none';
}

// ===== 刪除紀錄（管理員）=====
async function deleteRecord(id, type) {
  const table = type === 'booking' ? 'bookings' : 'blocked_slots';
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { showToast('刪除失敗', 'error'); return; }
  showToast('已刪除', 'success');
}

// ===== 渲染登記紀錄列表 =====
function renderBookingLog() {
  const el = document.getElementById('bookingLog');
  if (allBookings.length === 0) {
    el.innerHTML = '<div class="log-empty">尚無登記紀錄</div>';
    return;
  }
  el.innerHTML = allBookings.map(b => {
    const vehicle = b.vehicles || {};
    return `
      <div class="log-item">
        <div class="log-date">${b.date}</div>
        <div class="log-info">
          <span class="log-name">${b.user_name}</span>
          <span class="log-period">${periodLabel(b.period, b.start_time, b.end_time)}</span>
          <span class="log-plate">${vehicle.plate || ''}</span>
        </div>
        <div class="log-purpose">${b.purpose}</div>
      </div>
    `;
  }).join('');
}

// ===== 管理員登入 =====
function openAdminModal() {
  if (adminLevel) {
    adminLevel = null;
    updateAdminBtn();
    if (selectedDate) renderSidebarContent();
    showToast('已登出管理員模式');
    return;
  }
  document.getElementById('adminPassword').value = '';
  document.getElementById('adminError').textContent = '';
  document.getElementById('adminModal').classList.add('open');
  setTimeout(() => document.getElementById('adminPassword').focus(), 100);
}

function confirmAdmin() {
  const pw = document.getElementById('adminPassword').value.trim();
  if (pw === PASSWORDS.super) {
    adminLevel = 'super';
  } else if (pw === PASSWORDS.offices[selectedOfficeName]) {
    adminLevel = 'office';
  } else {
    document.getElementById('adminError').textContent = '密碼錯誤';
    return;
  }
  document.getElementById('adminModal').classList.remove('open');
  updateAdminBtn();
  if (selectedDate) renderSidebarContent();
  showToast(adminLevel === 'super' ? '已進入超級管理員模式' : `已進入${selectedOfficeName}管理員模式`, 'success');
}

function updateAdminBtn() {
  const btn = document.getElementById('adminBtn');
  if (!adminLevel) {
    btn.textContent = '管理員入口';
    btn.classList.remove('active');
  } else if (adminLevel === 'super') {
    btn.textContent = '超級管理員（登出）';
    btn.classList.add('active');
  } else {
    btn.textContent = `${selectedOfficeName}管理員（登出）`;
    btn.classList.add('active');
  }
}

// ===== Toast 提示 =====
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ===== 事件監聽 =====
function setupEventListeners() {
  document.getElementById('prevMonth').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    loadBookingsAndBlocked();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    loadBookingsAndBlocked();
  });
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
  document.getElementById('submitBooking').addEventListener('click', submitBooking);
  document.getElementById('submitBlock').addEventListener('click', submitBlock);
  document.getElementById('adminBtn').addEventListener('click', openAdminModal);
  document.getElementById('adminConfirmBtn').addEventListener('click', confirmAdmin);
  document.getElementById('adminCancelBtn').addEventListener('click', () => {
    document.getElementById('adminModal').classList.remove('open');
  });
  document.getElementById('adminPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAdmin();
  });
  document.getElementById('backToOffices').addEventListener('click', () => {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    showOfficePicker();
  });
  document.querySelectorAll('input[name="period"]').forEach(input => {
    input.addEventListener('change', () => {
      document.getElementById('customTime').style.display = input.value === 'custom' ? 'flex' : 'none';
    });
  });
  document.querySelectorAll('input[name="blockPeriod"]').forEach(input => {
    input.addEventListener('change', () => {
      document.getElementById('blockCustomTime').style.display = input.value === 'custom' ? 'flex' : 'none';
    });
  });
}

// ===== 啟動 =====
init();
