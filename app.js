// ===== Supabase 設定 =====
const SUPABASE_URL = 'https://ioftnuhttlzkcbxlnsvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZnRudWh0dGx6a2NieGxuc3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMzIwNDcsImV4cCI6MjA5MTgwODA0N30.d4JzELooUvKMwxMgbZPBV5TxsVAR1kVOSEME_jFwJ2o';

// ===== 密碼設定 =====
const PASSWORDS = {
  super: 'super888',
  offices: { '新北': 'nb001', '桃園': 'ty001', '新竹': 'hc001', '宜蘭': 'yl001' }
};

// ===== 時段定義 =====
const PERIOD_TIMES = {
  morning:   { start: '08:00', end: '12:00' },
  afternoon: { start: '13:00', end: '18:00' },
  full:      { start: '08:00', end: '18:00' }
};

// ===== 封鎖常用原因 =====
const BLOCK_REASONS = ['車輛保養'];

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 狀態 =====
let offices = [];
let vehicles = [];
let employees = [];
let bookings = {};      // { vehicleId: [...] }
let blockedSlots = {};  // { vehicleId: [...] }
let allBookings = [];
let selectedOfficeId = null;
let selectedOfficeName = null;
let selectedDate = null;
let selectedVehicleIdInSidebar = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let adminLevel = null;
let realtimeChannel = null;

// ===== 初始化 =====
async function init() {
  await loadOffices();
  await loadEmployees();
  setupEventListeners();
  // 記住上次選擇的辦公室
  const savedOfficeId = sessionStorage.getItem('selectedOfficeId');
  const savedOfficeName = sessionStorage.getItem('selectedOfficeName');
  if (savedOfficeId && savedOfficeName && offices.find(o => o.id === savedOfficeId)) {
    enterOffice(savedOfficeId, savedOfficeName);
  } else {
    showOfficePicker();
  }
}

// ===== 載入辦公室 =====
async function loadOffices() {
  const { data } = await db.from('offices').select('*').order('name');
  offices = data || [];
}

// ===== 載入員工 =====
async function loadEmployees() {
  const { data } = await db.from('employees').select('*');
  employees = data || [];
}

// ===== 辦公室選擇畫面 =====
function showOfficePicker() {
  sessionStorage.removeItem('selectedOfficeId');
  sessionStorage.removeItem('selectedOfficeName');
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
  sessionStorage.setItem('selectedOfficeId', id);
  sessionStorage.setItem('selectedOfficeName', name);
  // 超級管理員跨辦公室保持登入
  if (adminLevel !== 'super') adminLevel = null;
  document.getElementById('officePicker').style.display = 'none';
  document.getElementById('mainApp').style.display = 'block';
  document.getElementById('currentOfficeName').textContent = name;
  updateAdminBtn();
  await loadVehicles(id);
  renderCalendar();
  await loadMonthData();
  await loadAllBookings();
}

// ===== 載入車輛 =====
async function loadVehicles(officeId) {
  const { data } = await db.from('vehicles').select('*').eq('office_id', officeId).order('name');
  vehicles = data || [];
  renderVehicleManagement();
}

// ===== 載入當月資料（所有車輛）=====
async function loadMonthData() {
  const startDate = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];
  const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];
  const vehicleIds = vehicles.map(v => v.id);
  if (vehicleIds.length === 0) { bookings = {}; blockedSlots = {}; renderCalendar(); return; }

  const [b, bl] = await Promise.all([
    db.from('bookings').select('*').in('vehicle_id', vehicleIds).gte('date', startDate).lte('date', endDate),
    db.from('blocked_slots').select('*').in('vehicle_id', vehicleIds).gte('date', startDate).lte('date', endDate)
  ]);

  bookings = {};
  blockedSlots = {};
  (b.data || []).forEach(item => {
    if (!bookings[item.vehicle_id]) bookings[item.vehicle_id] = [];
    bookings[item.vehicle_id].push(item);
  });
  (bl.data || []).forEach(item => {
    if (!blockedSlots[item.vehicle_id]) blockedSlots[item.vehicle_id] = [];
    blockedSlots[item.vehicle_id].push(item);
  });
  renderCalendar();
  if (selectedDate) renderSidebar(selectedDate);
}

// ===== 載入全部登記紀錄 =====
async function loadAllBookings() {
  const vehicleIds = vehicles.map(v => v.id);
  if (vehicleIds.length === 0) { allBookings = []; renderBookingLog(); return; }
  const { data } = await db
    .from('bookings')
    .select('*, vehicles(name, plate)')
    .in('vehicle_id', vehicleIds)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  allBookings = data || [];
  renderBookingLog();
}

// ===== Realtime =====
function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel('car-booking-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => {
      loadMonthData(); loadAllBookings();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, () => {
      loadMonthData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
      loadVehicles(selectedOfficeId).then(() => { loadMonthData(); loadAllBookings(); });
    })
    .subscribe();
}

// ===== 月曆渲染 =====
function renderCalendar() {
  document.getElementById('calendarTitle').textContent = `${currentYear} 年 ${currentMonth + 1} 月`;
  const grid = document.getElementById('calendarGrid');
  const weekdays = ['日','一','二','三','四','五','六'];
  let html = weekdays.map(d => `<div class="calendar-weekday">${d}</div>`).join('');
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date();
  for (let i = 0; i < firstDay; i++) html += `<div class="calendar-day empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getFullYear()===currentYear && today.getMonth()===currentMonth && today.getDate()===d;
    const isPast = new Date(currentYear,currentMonth,d) < new Date(today.getFullYear(),today.getMonth(),today.getDate());
    // 計算當天所有車輛的整體狀態
    const dayStatus = getDayOverallStatus(dateStr);
    let dotHtml = '';
    if (dayStatus === 'blocked') dotHtml = `<span class="dot-small blocked"></span>`;
    else if (dayStatus === 'full') dotHtml = `<span class="dot-small full"></span>`;
    else if (dayStatus === 'partial') dotHtml = `<span class="dot-small partial"></span>`;
    else if (!isPast) dotHtml = `<span class="dot-small available"></span>`;
    html += `<div class="calendar-day ${isToday?'today':''} ${isPast?'past':''}" data-date="${dateStr}">
      <span class="day-num">${d}</span>
      <div class="day-dots">${dotHtml}</div>
    </div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.calendar-day:not(.empty):not(.past)').forEach(el => {
    el.addEventListener('click', () => openSidebar(el.dataset.date));
  });
}

// ===== 當天整體狀態（所有車輛）=====
function getDayOverallStatus(dateStr) {
  if (vehicles.length === 0) return 'available';
  const statuses = vehicles.map(v => {
    const vb = (bookings[v.id] || []).filter(b => b.date === dateStr);
    const vbl = (blockedSlots[v.id] || []).filter(b => b.date === dateStr);
    return getVehicleDayStatus(vb, vbl);
  });
  if (statuses.every(s => s === 'full' || s === 'blocked')) return 'full';
  if (statuses.some(s => s !== 'available')) return 'partial';
  return 'available';
}

// ===== 單一車輛當天狀態 =====
function getVehicleDayStatus(dayBookings, dayBlocked) {
  if (dayBlocked.some(b => b.period === 'full')) return 'blocked';
  const bMorning = dayBlocked.some(b => b.period === 'morning');
  const bAfternoon = dayBlocked.some(b => b.period === 'afternoon');
  if (bMorning && bAfternoon) return 'blocked';
  const bookedFull = dayBookings.some(b => b.period === 'full');
  const bookedMorning = dayBookings.some(b => b.period === 'morning');
  const bookedAfternoon = dayBookings.some(b => b.period === 'afternoon');
  if (bookedFull || (bookedMorning && bookedAfternoon)) return 'full';
  if (bookedMorning || bookedAfternoon || dayBookings.length > 0 || bMorning || bAfternoon) return 'partial';
  return 'available';
}

// ===== 開啟側邊欄 =====
function openSidebar(dateStr) {
  selectedDate = dateStr;
  selectedVehicleIdInSidebar = null;
  const [y, m, d] = dateStr.split('-');
  const weekdays = ['日','一','二','三','四','五','六'];
  const dow = new Date(dateStr).getDay();
  document.getElementById('sidebarDate').textContent = `${y}/${parseInt(m)}/${parseInt(d)}（${weekdays[dow]}）`;
  renderSidebar(dateStr);
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}

// ===== 關閉側邊欄 =====
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  selectedDate = null;
  selectedVehicleIdInSidebar = null;
}

// ===== 渲染側邊欄 =====
function renderSidebar(dateStr) {
  const body = document.getElementById('sidebarBody');
  if (!selectedVehicleIdInSidebar) {
    // 顯示當天所有車輛狀態
    renderVehicleList(dateStr);
  } else {
    // 顯示單一車輛的預約詳情與表單
    renderVehicleDetail(dateStr, selectedVehicleIdInSidebar);
  }
}

// ===== 側邊欄：車輛列表 =====
function renderVehicleList(dateStr) {
  const body = document.getElementById('sidebarBody');
  if (vehicles.length === 0) {
    body.innerHTML = '<div class="empty-state">此辦公室尚無車輛</div>';
    return;
  }
  let html = '<div class="vehicle-list-label">點選車輛查看詳情或登記</div>';
  vehicles.forEach(v => {
    const vb = (bookings[v.id] || []).filter(b => b.date === dateStr);
    const vbl = (blockedSlots[v.id] || []).filter(b => b.date === dateStr);
    const status = getVehicleDayStatus(vb, vbl);
    const statusLabel = { available:'可借用', partial:'部分已借', full:'已借滿', blocked:'封鎖中' }[status];
    const statusClass = { available:'status-available', partial:'status-partial', full:'status-full', blocked:'status-blocked' }[status];
    html += `
      <div class="vehicle-day-card ${statusClass}" data-vid="${v.id}">
        <div class="vdc-info">
          <div class="vdc-name">${v.name || '未命名'}</div>
          <div class="vdc-plate">${v.plate}</div>
        </div>
        <div class="vdc-status">${statusLabel}</div>
        <div class="vdc-arrow">›</div>
      </div>`;
  });
  body.innerHTML = html;
  body.querySelectorAll('.vehicle-day-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedVehicleIdInSidebar = card.dataset.vid;
      renderVehicleDetail(dateStr, card.dataset.vid);
    });
  });
}

// ===== 側邊欄：單一車輛詳情 =====
function renderVehicleDetail(dateStr, vehicleId) {
  const body = document.getElementById('sidebarBody');
  const vehicle = vehicles.find(v => v.id === vehicleId);
  const dayBookings = (bookings[vehicleId] || []).filter(b => b.date === dateStr);
  const dayBlocked = (blockedSlots[vehicleId] || []).filter(b => b.date === dateStr);

  const all = [...dayBookings, ...dayBlocked];
  const blockedFull = all.some(b => b.period === 'full');
  const blockedMorning = all.some(b => b.period === 'morning');
  const blockedAfternoon = all.some(b => b.period === 'afternoon');

  // 已有紀錄
  let recordsHtml = '';
  dayBlocked.forEach(bl => {
    recordsHtml += `<div class="booking-item blocked-item">
      <div class="booking-info">
        <div class="booking-period">🔒 ${periodLabel(bl.period, bl.start_time, bl.end_time)}</div>
        <div class="booking-name">${bl.reason || '（無說明）'}</div>
      </div>
      ${adminLevel ? `<button class="booking-delete" data-id="${bl.id}" data-type="blocked">✕</button>` : ''}
    </div>`;
  });
  dayBookings.forEach(bk => {
    const timeStr = bk.created_at ? new Date(bk.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    recordsHtml += `<div class="booking-item">
      <div class="booking-info">
        <div class="booking-period">${periodLabel(bk.period, bk.start_time, bk.end_time)}</div>
        <div class="booking-name">${bk.user_name}</div>
        <div class="booking-purpose">${bk.purpose}</div>
        <div class="booking-time">${timeStr}</div>
      </div>
      ${adminLevel ? `<button class="booking-delete" data-id="${bk.id}" data-type="booking">✕</button>` : ''}
    </div>`;
  });
  if (!recordsHtml) recordsHtml = '<div class="empty-state">此日期尚無預約</div>';

  // 預約表單
  const periodDisabled = {
    full: blockedFull || blockedMorning || blockedAfternoon,
    morning: blockedFull || blockedMorning,
    afternoon: blockedFull || blockedAfternoon,
  };

  const blockReasonsHtml = BLOCK_REASONS.map(r =>
    `<button class="reason-btn" onclick="setBlockReason('${r}')">${r}</button>`
  ).join('');

  body.innerHTML = `
    <button class="back-to-list-btn" id="backToList">← 返回車輛列表</button>
    <div class="vehicle-detail-header">
      <span class="vdh-name">${vehicle?.name || ''}</span>
      <span class="vdh-plate">${vehicle?.plate || ''}</span>
    </div>

    <div class="booking-list">${recordsHtml}</div>

    <div class="booking-form">
      <div class="form-title">新增預約</div>
      <div class="form-group">
        <label>員工編號</label>
        <div class="emp-row">
          <input type="text" class="form-input" id="empId" placeholder="輸入員工編號">
          <button class="btn btn-ghost btn-sm" id="lookupEmp">查詢</button>
        </div>
      </div>
      <div class="form-group">
        <label>姓名</label>
        <input type="text" class="form-input" id="userName" placeholder="請輸入姓名">
      </div>
      <div class="form-group">
        <label>用途 / 專案名</label>
        <input type="text" class="form-input" id="userPurpose" placeholder="請輸入用途或專案名稱">
      </div>
      <div class="form-group">
        <label>時段</label>
        <div class="period-options">
          <label class="period-opt" style="${periodDisabled.full?'opacity:.4;pointer-events:none':''}">
            <input type="radio" name="period" value="full" ${periodDisabled.full?'disabled':''}> 整天
          </label>
          <label class="period-opt" style="${periodDisabled.morning?'opacity:.4;pointer-events:none':''}">
            <input type="radio" name="period" value="morning" ${periodDisabled.morning?'disabled':''}> 上午
          </label>
          <label class="period-opt" style="${periodDisabled.afternoon?'opacity:.4;pointer-events:none':''}">
            <input type="radio" name="period" value="afternoon" ${periodDisabled.afternoon?'disabled':''}> 下午
          </label>
          <label class="period-opt">
            <input type="radio" name="period" value="custom"> 自訂
          </label>
        </div>
      </div>
      <div class="form-group" id="customTime" style="display:none">
        <label>自訂時間</label>
        <div class="time-row">
          <input type="time" class="time-input" id="startTime">
          <span>—</span>
          <input type="time" class="time-input" id="endTime">
        </div>
      </div>
      <button class="btn btn-primary btn-block" id="submitBooking">確認預約</button>
    </div>

    ${adminLevel ? `
    <div class="admin-section">
      <div class="form-title admin-title">🔧 管理員封鎖</div>
      <div class="form-group">
        <label>封鎖對象</label>
        <div class="period-options">
          <label class="period-opt"><input type="radio" name="blockTarget" value="single" checked> 此車輛</label>
          <label class="period-opt"><input type="radio" name="blockTarget" value="all"> 所有車輛</label>
        </div>
      </div>
      <div class="form-group">
        <label>封鎖時段</label>
        <div class="period-options">
          <label class="period-opt"><input type="radio" name="blockPeriod" value="full"> 整天</label>
          <label class="period-opt"><input type="radio" name="blockPeriod" value="morning"> 上午</label>
          <label class="period-opt"><input type="radio" name="blockPeriod" value="afternoon"> 下午</label>
          <label class="period-opt"><input type="radio" name="blockPeriod" value="custom"> 自訂</label>
        </div>
      </div>
      <div class="form-group" id="blockCustomTime" style="display:none">
        <label>自訂時間</label>
        <div class="time-row">
          <input type="time" class="time-input" id="blockStartTime">
          <span>—</span>
          <input type="time" class="time-input" id="blockEndTime">
        </div>
      </div>
      <div class="form-group">
        <label>原因</label>
        <div class="reason-btns">${blockReasonsHtml}</div>
        <input type="text" class="form-input" id="blockReason" placeholder="輸入或選擇原因（選填）" style="margin-top:6px">
      </div>
      <button class="btn btn-danger btn-block" id="submitBlock">封鎖此時段</button>
    </div>
    ` : ''}

    ${adminLevel ? `
    <div class="admin-section">
      <div class="form-title admin-title">📊 匯出紀錄</div>
      <button class="btn btn-ghost btn-block" id="exportBtn">匯出當月 Excel</button>
    </div>
    ` : ''}
  `;

  // 事件綁定
  document.getElementById('backToList')?.addEventListener('click', () => {
    selectedVehicleIdInSidebar = null;
    renderVehicleList(dateStr);
  });
  document.getElementById('lookupEmp')?.addEventListener('click', lookupEmployee);
  document.getElementById('empId')?.addEventListener('keydown', e => { if (e.key === 'Enter') lookupEmployee(); });
  document.getElementById('submitBooking')?.addEventListener('click', submitBooking);
  document.getElementById('submitBlock')?.addEventListener('click', submitBlock);
  document.getElementById('exportBtn')?.addEventListener('click', exportExcel);
  document.querySelectorAll('input[name="period"]').forEach(input => {
    input.addEventListener('change', () => {
      document.getElementById('customTime').style.display = input.value === 'custom' ? 'flex' : 'none';
    });
  });
  document.querySelectorAll('input[name="blockPeriod"]').forEach(input => {
    input.addEventListener('change', () => {
      const bt = document.getElementById('blockCustomTime');
      if (bt) bt.style.display = input.value === 'custom' ? 'flex' : 'none';
    });
  });
  body.querySelectorAll('.booking-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteRecord(btn.dataset.id, btn.dataset.type));
  });
}

// ===== 員工編號查詢 =====
function lookupEmployee() {
  const empId = document.getElementById('empId')?.value.trim();
  if (!empId) return;
  const emp = employees.find(e => e.employee_id === empId);
  if (emp) {
    document.getElementById('userName').value = emp.name;
    showToast(`找到：${emp.name}`, 'success');
  } else {
    showToast('找不到此員工編號', 'error');
  }
}

// ===== 設定封鎖原因 =====
function setBlockReason(reason) {
  const el = document.getElementById('blockReason');
  if (el) el.value = reason;
}

// ===== 時段標籤 =====
function periodLabel(period, start, end) {
  if (period === 'full') return '整天';
  if (period === 'morning') return '上午';
  if (period === 'afternoon') return '下午';
  if (period === 'custom') return `${(start||'').slice(0,5)} — ${(end||'').slice(0,5)}`;
  return period;
}

// ===== 時間轉分鐘 =====
function toMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// ===== 時段轉為開始/結束分鐘 =====
function periodToRange(period, startTime, endTime) {
  if (period === 'full')      return { s: toMinutes('08:00'), e: toMinutes('18:00') };
  if (period === 'morning')   return { s: toMinutes('08:00'), e: toMinutes('12:00') };
  if (period === 'afternoon') return { s: toMinutes('13:00'), e: toMinutes('18:00') };
  if (period === 'custom')    return { s: toMinutes(startTime), e: toMinutes(endTime) };
  return null;
}

// ===== 時間範圍是否重疊 =====
function rangesOverlap(a, b) {
  return a.s < b.e && a.e > b.s;
}

// ===== 衝突檢查（含自訂時段）=====
function hasConflict(period, startTime, endTime, dayBookings, dayBlocked) {
  const newRange = periodToRange(period, startTime, endTime);
  if (!newRange) return false;
  const all = [...dayBookings, ...dayBlocked];
  return all.some(item => {
    const existing = periodToRange(item.period, item.start_time, item.end_time);
    if (!existing) return false;
    return rangesOverlap(newRange, existing);
  });
}

// ===== 新增預約 =====
async function submitBooking() {
  const period = document.querySelector('input[name="period"]:checked')?.value;
  const userName = document.getElementById('userName')?.value.trim();
  const purpose = document.getElementById('userPurpose')?.value.trim();
  const startTime = document.getElementById('startTime')?.value;
  const endTime = document.getElementById('endTime')?.value;
  if (!period) { showToast('請選擇時段', 'error'); return; }
  if (!userName) { showToast('請輸入姓名', 'error'); return; }
  if (!purpose) { showToast('請輸入用途', 'error'); return; }
  if (period === 'custom' && (!startTime || !endTime)) { showToast('請輸入自訂時間', 'error'); return; }
  if (period === 'custom' && toMinutes(startTime) >= toMinutes(endTime)) { showToast('結束時間須晚於開始時間', 'error'); return; }

  const dayBookings = (bookings[selectedVehicleIdInSidebar] || []).filter(b => b.date === selectedDate);
  const dayBlocked = (blockedSlots[selectedVehicleIdInSidebar] || []).filter(b => b.date === selectedDate);
  if (hasConflict(period, startTime, endTime, dayBookings, dayBlocked)) {
    showToast('此時段與現有預約或封鎖衝突', 'error'); return;
  }

  const btn = document.getElementById('submitBooking');
  btn.disabled = true; btn.textContent = '處理中...';

  const { error } = await db.from('bookings').insert({
    vehicle_id: selectedVehicleIdInSidebar,
    date: selectedDate, period, user_name: userName, purpose,
    start_time: period === 'custom' ? startTime : null,
    end_time: period === 'custom' ? endTime : null,
  });

  btn.disabled = false; btn.textContent = '確認預約';
  if (error) { showToast('預約失敗，請重試', 'error'); return; }
  showToast('預約成功！', 'success');
  await loadMonthData();
  await loadAllBookings();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 封鎖時段 =====
async function submitBlock() {
  const period = document.querySelector('input[name="blockPeriod"]:checked')?.value;
  const target = document.querySelector('input[name="blockTarget"]:checked')?.value || 'single';
  const reason = document.getElementById('blockReason')?.value.trim();
  const startTime = document.getElementById('blockStartTime')?.value;
  const endTime = document.getElementById('blockEndTime')?.value;
  if (!period) { showToast('請選擇封鎖時段', 'error'); return; }
  if (period === 'custom' && (!startTime || !endTime)) { showToast('請輸入自訂時間', 'error'); return; }

  const btn = document.getElementById('submitBlock');
  btn.disabled = true; btn.textContent = '處理中...';

  const targetVehicles = target === 'all' ? vehicles.map(v => v.id) : [selectedVehicleIdInSidebar];
  const inserts = targetVehicles.map(vid => ({
    vehicle_id: vid, date: selectedDate, period,
    reason: reason || null,
    start_time: period === 'custom' ? startTime : null,
    end_time: period === 'custom' ? endTime : null,
  }));

  const { error } = await db.from('blocked_slots').insert(inserts);
  btn.disabled = false; btn.textContent = '封鎖此時段';
  if (error) { showToast('封鎖失敗，請重試', 'error'); return; }
  showToast(target === 'all' ? '已封鎖所有車輛' : '時段已封鎖', 'success');
  await loadMonthData();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 刪除紀錄 =====
async function deleteRecord(id, type) {
  const table = type === 'booking' ? 'bookings' : 'blocked_slots';
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { showToast('刪除失敗', 'error'); return; }
  showToast('已刪除', 'success');
  await loadMonthData();
  await loadAllBookings();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 登記紀錄列表 =====
function renderBookingLog() {
  const el = document.getElementById('bookingLog');
  if (!el) return;
  if (allBookings.length === 0) { el.innerHTML = '<div class="log-empty">尚無登記紀錄</div>'; return; }
  const weekdays = ['日','一','二','三','四','五','六'];
  el.innerHTML = allBookings.map(b => {
    const vehicle = b.vehicles || {};
    const dow = new Date(b.date).getDay();
    const timeStr = b.created_at ? new Date(b.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="log-item">
      <div class="log-left">
        <div class="log-date">${b.date}</div>
        <div class="log-dow">（${weekdays[dow]}）</div>
      </div>
      <div class="log-right">
        <div class="log-row1">
          <span class="log-name">${b.user_name}</span>
          <span class="log-period">${periodLabel(b.period, b.start_time, b.end_time)}</span>
          <span class="log-plate">${vehicle.plate || ''}</span>
        </div>
        <div class="log-row2">${b.purpose}</div>
        <div class="log-row3">${timeStr} 登記</div>
      </div>
    </div>`;
  }).join('');
}

// ===== 車輛管理 =====
function renderVehicleManagement() {
  const el = document.getElementById('vehicleMgmt');
  if (!el) return;
  if (!adminLevel) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const list = document.getElementById('vehicleMgmtList');
  list.innerHTML = vehicles.map(v => `
    <div class="mgmt-item">
      <span class="mgmt-name">${v.name || '未命名'}</span>
      <span class="mgmt-plate">${v.plate}</span>
      <button class="mgmt-delete" data-id="${v.id}">刪除</button>
    </div>
  `).join('') || '<div class="empty-state">尚無車輛</div>';
  list.querySelectorAll('.mgmt-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteVehicle(btn.dataset.id));
  });
}

async function addVehicle() {
  const name = document.getElementById('newVehicleName')?.value.trim();
  const plate = document.getElementById('newVehiclePlate')?.value.trim();
  if (!name || !plate) { showToast('請填寫車輛名稱與車牌', 'error'); return; }
  const { error } = await db.from('vehicles').insert({ office_id: selectedOfficeId, name, plate });
  if (error) { showToast('新增失敗', 'error'); return; }
  document.getElementById('newVehicleName').value = '';
  document.getElementById('newVehiclePlate').value = '';
  showToast('車輛已新增', 'success');
}

async function deleteVehicle(id) {
  const { error } = await db.from('vehicles').delete().eq('id', id);
  if (error) { showToast('刪除失敗', 'error'); return; }
  showToast('車輛已刪除', 'success');
}

// ===== 匯出 Excel =====
async function exportExcel() {
  const vehicleIds = vehicles.map(v => v.id);
  const startDate = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];
  const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];
  const { data } = await db.from('bookings')
    .select('*, vehicles(name, plate)')
    .in('vehicle_id', vehicleIds)
    .gte('date', startDate).lte('date', endDate)
    .order('date').order('created_at');

  if (!data || data.length === 0) { showToast('當月無資料', 'error'); return; }

  const weekdays = ['日','一','二','三','四','五','六'];
  const rows = [['日期','星期','車輛名稱','車牌','時段','姓名','用途','登記時間']];
  data.forEach(b => {
    const dow = weekdays[new Date(b.date).getDay()];
    const time = b.created_at ? new Date(b.created_at).toLocaleString('zh-TW') : '';
    rows.push([b.date, dow, b.vehicles?.name||'', b.vehicles?.plate||'', periodLabel(b.period, b.start_time, b.end_time), b.user_name, b.purpose, time]);
  });

  // 用 CSV 格式下載（不需額外套件）
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `公務車紀錄_${selectedOfficeName}_${currentYear}${String(currentMonth+1).padStart(2,'0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('匯出成功', 'success');
}

// ===== 管理員 =====
function openAdminModal() {
  if (adminLevel) {
    adminLevel = null;
    updateAdminBtn();
    renderVehicleManagement();
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
  renderVehicleManagement();
  if (selectedDate && selectedVehicleIdInSidebar) renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
  showToast(adminLevel === 'super' ? '超級管理員模式' : `${selectedOfficeName}管理員模式`, 'success');
}

function updateAdminBtn() {
  const btn = document.getElementById('adminBtn');
  if (!adminLevel) { btn.textContent = '管理員入口'; btn.classList.remove('active'); }
  else if (adminLevel === 'super') { btn.textContent = '超級管理員（登出）'; btn.classList.add('active'); }
  else { btn.textContent = `${selectedOfficeName}管理員（登出）`; btn.classList.add('active'); }
}

// ===== Toast =====
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ===== 事件監聽 =====
function setupEventListeners() {
  document.getElementById('prevMonth').addEventListener('click', () => {
    currentMonth--; if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    loadMonthData();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    currentMonth++; if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    loadMonthData();
  });
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
  document.getElementById('adminBtn').addEventListener('click', openAdminModal);
  document.getElementById('adminConfirmBtn').addEventListener('click', confirmAdmin);
  document.getElementById('adminCancelBtn').addEventListener('click', () => {
    document.getElementById('adminModal').classList.remove('open');
  });
  document.getElementById('adminPassword').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAdmin(); });
  document.getElementById('backToOffices').addEventListener('click', () => {
    if (realtimeChannel) db.removeChannel(realtimeChannel);
    showOfficePicker();
  });
  document.getElementById('addVehicleBtn')?.addEventListener('click', addVehicle);
}

// ===== 啟動 =====
init().then(() => subscribeRealtime());
