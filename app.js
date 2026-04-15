// ===== Supabase 設定 =====
const SUPABASE_URL = 'https://ioftnuhttlzkcbxlnsvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZnRudWh0dGx6a2NieGxuc3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMzIwNDcsImV4cCI6MjA5MTgwODA0N30.d4JzELooUvKMwxMgbZPBV5TxsVAR1kVOSEME_jFwJ2o';
const ADMIN_PASSWORD = 'admin1234'; // ← 可以改成你想要的密碼

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 狀態 =====
let offices = [];
let vehicles = [];
let bookings = [];
let blockedSlots = [];
let selectedOfficeId = null;
let selectedVehicleId = null;
let selectedDate = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let isAdmin = false;
let realtimeChannel = null;

// ===== 初始化 =====
async function init() {
  await loadOffices();
  setupEventListeners();
  renderCalendar();
}

// ===== 載入辦公室 =====
async function loadOffices() {
  const { data, error } = await db.from('offices').select('*').order('name');
  if (error) { showToast('載入辦公室失敗', 'error'); return; }
  offices = data;
  renderOfficeTabs();
  if (offices.length > 0) selectOffice(offices[0].id);
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

// ===== 載入預約與封鎖 =====
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

// ===== Realtime 訂閱 =====
function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = supabase
    .channel('car-booking-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => loadBookingsAndBlocked())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, () => loadBookingsAndBlocked())
    .subscribe();
}

// ===== 選擇辦公室 =====
function selectOffice(id) {
  selectedOfficeId = id;
  document.querySelectorAll('.office-tab').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  loadVehicles(id);
}

// ===== 選擇車輛 =====
function selectVehicle(id) {
  selectedVehicleId = id;
  document.querySelectorAll('.vehicle-tab').forEach(el => el.classList.toggle('active', el.dataset.id === id));
  subscribeRealtime();
  loadBookingsAndBlocked();
}

// ===== 渲染辦公室標籤 =====
function renderOfficeTabs() {
  const el = document.getElementById('officeTabs');
  el.innerHTML = offices.map(o => `
    <button class="office-tab" data-id="${o.id}">${o.name}</button>
  `).join('');
  el.querySelectorAll('.office-tab').forEach(btn => {
    btn.addEventListener('click', () => selectOffice(btn.dataset.id));
  });
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

  // 空格
  for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === d;
    const isPast = new Date(currentYear, currentMonth, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const dayBookings = bookings.filter(b => b.date === dateStr);
    const dayBlocked = blockedSlots.filter(b => b.date === dateStr);

    let dotHtml = '';
    if (dayBlocked.length > 0) dotHtml += `<span class="dot-small blocked"></span>`;
    if (dayBookings.length > 0) {
      const hasFull = dayBookings.some(b => b.period === 'full');
      const hasMorning = dayBookings.some(b => b.period === 'morning');
      const hasAfternoon = dayBookings.some(b => b.period === 'afternoon');
      if (hasFull || (hasMorning && hasAfternoon)) dotHtml += `<span class="dot-small full"></span>`;
      else dotHtml += `<span class="dot-small partial"></span>`;
    }
    if (!dotHtml && !isPast) dotHtml = `<span class="dot-small available"></span>`;

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

  // 封鎖時段
  dayBlocked.forEach(bl => {
    html += `
      <div class="booking-item blocked-item">
        <div class="booking-info">
          <div class="booking-period">🔒 封鎖：${periodLabel(bl.period, bl.start_time, bl.end_time)}</div>
          <div class="booking-name">${bl.reason || '（無說明）'}</div>
        </div>
        <button class="booking-delete ${isAdmin ? '' : 'hidden'}" data-id="${bl.id}" data-type="blocked">✕</button>
      </div>
    `;
  });

  // 預約紀錄
  dayBookings.forEach(bk => {
    html += `
      <div class="booking-item">
        <div class="booking-info">
          <div class="booking-period">${periodLabel(bk.period, bk.start_time, bk.end_time)}</div>
          <div class="booking-name">${bk.user_name}</div>
          <div class="booking-purpose">${bk.purpose}</div>
        </div>
        <button class="booking-delete ${isAdmin ? '' : 'hidden'}" data-id="${bk.id}" data-type="booking">✕</button>
      </div>
    `;
  });

  if (!html) html = '<div class="empty-state">此日期尚無預約</div>';
  bookingList.innerHTML = html;

  // 刪除事件
  bookingList.querySelectorAll('.booking-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteRecord(btn.dataset.id, btn.dataset.type));
  });

  // 管理員區塊顯示
  document.getElementById('adminSection').style.display = isAdmin ? 'flex' : 'none';
}

// ===== 時段標籤 =====
function periodLabel(period, start, end) {
  if (period === 'full') return '整天';
  if (period === 'morning') return '上午';
  if (period === 'afternoon') return '下午';
  if (period === 'custom') return `${start?.slice(0,5) || ''} — ${end?.slice(0,5) || ''}`;
  return period;
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

  const payload = {
    vehicle_id: selectedVehicleId,
    date: selectedDate,
    period,
    user_name: userName,
    purpose,
    start_time: period === 'custom' ? startTime : null,
    end_time: period === 'custom' ? endTime : null,
  };

  const { error } = await db.from('bookings').insert(payload);
  if (error) { showToast('預約失敗，請重試', 'error'); return; }

  showToast('預約成功！', 'success');
  document.getElementById('userName').value = '';
  document.getElementById('userPurpose').value = '';
  document.querySelector('input[name="period"]:checked').checked = false;
}

// ===== 封鎖時段（管理員）=====
async function submitBlock() {
  const period = document.querySelector('input[name="blockPeriod"]:checked')?.value;
  const reason = document.getElementById('blockReason').value.trim();
  const startTime = document.getElementById('blockStartTime').value;
  const endTime = document.getElementById('blockEndTime').value;

  if (!period) { showToast('請選擇封鎖時段', 'error'); return; }
  if (period === 'custom' && (!startTime || !endTime)) { showToast('請輸入自訂時間', 'error'); return; }

  const payload = {
    vehicle_id: selectedVehicleId,
    date: selectedDate,
    period,
    reason: reason || null,
    start_time: period === 'custom' ? startTime : null,
    end_time: period === 'custom' ? endTime : null,
  };

  const { error } = await db.from('blocked_slots').insert(payload);
  if (error) { showToast('封鎖失敗，請重試', 'error'); return; }

  showToast('時段已封鎖', 'success');
  document.getElementById('blockReason').value = '';
  document.querySelector('input[name="blockPeriod"]:checked').checked = false;
}

// ===== 刪除紀錄（管理員）=====
async function deleteRecord(id, type) {
  const table = type === 'booking' ? 'bookings' : 'blocked_slots';
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { showToast('刪除失敗', 'error'); return; }
  showToast('已刪除', 'success');
}

// ===== 管理員登入 =====
function openAdminModal() {
  if (isAdmin) {
    isAdmin = false;
    document.getElementById('adminBtn').classList.remove('active');
    document.getElementById('adminBtn').textContent = '管理員入口';
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
  const pw = document.getElementById('adminPassword').value;
  if (pw === ADMIN_PASSWORD) {
    isAdmin = true;
    document.getElementById('adminModal').classList.remove('open');
    document.getElementById('adminBtn').classList.add('active');
    document.getElementById('adminBtn').textContent = '管理員模式（登出）';
    if (selectedDate) renderSidebarContent();
    showToast('已進入管理員模式', 'success');
  } else {
    document.getElementById('adminError').textContent = '密碼錯誤';
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
  // 月曆切換
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

  // 側邊欄關閉
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

  // 預約送出
  document.getElementById('submitBooking').addEventListener('click', submitBooking);

  // 封鎖送出
  document.getElementById('submitBlock').addEventListener('click', submitBlock);

  // 管理員
  document.getElementById('adminBtn').addEventListener('click', openAdminModal);
  document.getElementById('adminConfirmBtn').addEventListener('click', confirmAdmin);
  document.getElementById('adminCancelBtn').addEventListener('click', () => {
    document.getElementById('adminModal').classList.remove('open');
  });
  document.getElementById('adminPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmAdmin();
  });

  // 自訂時間顯示/隱藏
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
