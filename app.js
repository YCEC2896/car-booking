// ===== Supabase 設定 =====
const SUPABASE_URL = 'https://ioftnuhttlzkcbxlnsvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZnRudWh0dGx6a2NieGxuc3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMzIwNDcsImV4cCI6MjA5MTgwODA0N30.d4JzELooUvKMwxMgbZPBV5TxsVAR1kVOSEME_jFwJ2o';

// ===== 密碼設定 =====
const PASSWORDS = { admin: 'super888' };

// ===== 固定辦公室 =====
const FIXED_OFFICE_NAME = '新北';

// ===== 時段定義 =====
const PERIODS = [
  { value: 'full',      label: '整天',       start: '08:00', end: '18:00' },
  { value: 'am1',       label: '08:00–10:00', start: '08:00', end: '10:00' },
  { value: 'am2',       label: '10:00–12:30', start: '10:00', end: '12:30' },
  { value: 'pm1',       label: '12:30–15:00', start: '12:30', end: '15:00' },
  { value: 'pm2',       label: '15:00–18:00', start: '15:00', end: '18:00' },
];

const BLOCK_REASONS = ['車輛保養'];

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== 狀態 =====
let vehicles = [];
let employees = [];
let bookings = {};
let blockedSlots = {};
let allBookings = [];
let selectedOfficeId = null;
let selectedDate = null;
let selectedVehicleIdInSidebar = null;
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let adminLevel = null;
let realtimeChannel = null;

// ===== 初始化 =====
async function init() {
  await loadFixedOffice();
  await loadEmployees();
  setupEventListeners();
  await loadVehicles();
  await loadMonthData();
  await loadAllBookings();
  subscribeRealtime();
}

// ===== 載入固定辦公室（新北）=====
async function loadFixedOffice() {
  const { data } = await db.from('offices').select('*').eq('name', FIXED_OFFICE_NAME).single();
  if (data) {
    selectedOfficeId = data.id;
    document.getElementById('currentOfficeName').textContent = data.name;
  }
}

// ===== 載入員工 =====
async function loadEmployees() {
  const { data } = await db.from('employees').select('*');
  employees = data || [];
}

// ===== 載入車輛 =====
async function loadVehicles() {
  const { data } = await db.from('vehicles').select('*').eq('office_id', selectedOfficeId).order('name');
  vehicles = data || [];
  renderVehicleManagement();
}

// ===== 載入當月資料 =====
async function loadMonthData() {
  const startDate = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];
  const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];
  const vehicleIds = vehicles.map(v => v.id);
  if (!vehicleIds.length) { bookings = {}; blockedSlots = {}; renderCalendar(); return; }
  const [b, bl] = await Promise.all([
    db.from('bookings').select('*').in('vehicle_id', vehicleIds).gte('date', startDate).lte('date', endDate),
    db.from('blocked_slots').select('*').in('vehicle_id', vehicleIds).gte('date', startDate).lte('date', endDate)
  ]);
  bookings = {};
  blockedSlots = {};
  (b.data || []).forEach(item => { if (!bookings[item.vehicle_id]) bookings[item.vehicle_id] = []; bookings[item.vehicle_id].push(item); });
  (bl.data || []).forEach(item => { if (!blockedSlots[item.vehicle_id]) blockedSlots[item.vehicle_id] = []; blockedSlots[item.vehicle_id].push(item); });
  renderCalendar();
  if (selectedDate) renderSidebar(selectedDate);
}

// ===== 載入全部登記紀錄 =====
async function loadAllBookings() {
  const vehicleIds = vehicles.map(v => v.id);
  if (!vehicleIds.length) { allBookings = []; renderBookingLog(); return; }
  const { data } = await db.from('bookings').select('*, vehicles(name, plate)').in('vehicle_id', vehicleIds).order('date', { ascending: false }).order('created_at', { ascending: false });
  allBookings = data || [];
  renderBookingLog();
}

// ===== Realtime =====
function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel('car-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { loadMonthData(); loadAllBookings(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, () => { loadMonthData(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => { loadVehicles().then(() => { loadMonthData(); loadAllBookings(); }); })
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
    const status = getDayOverallStatus(dateStr);
    let dotHtml = '';
    if (status==='blocked') dotHtml=`<span class="dot-small blocked"></span>`;
    else if (status==='full') dotHtml=`<span class="dot-small full"></span>`;
    else if (status==='partial') dotHtml=`<span class="dot-small partial"></span>`;
    else if (!isPast) dotHtml=`<span class="dot-small available"></span>`;
    html += `<div class="calendar-day ${isToday?'today':''} ${isPast?'past':''}" data-date="${dateStr}"><span class="day-num">${d}</span><div class="day-dots">${dotHtml}</div></div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.calendar-day:not(.empty):not(.past)').forEach(el => {
    el.addEventListener('click', () => openSidebar(el.dataset.date));
  });
}

// ===== 時段工具 =====
function toMinutes(timeStr) { const [h,m] = (timeStr||'').split(':').map(Number); return h*60+(m||0); }
function getPeriodRange(value) { return PERIODS.find(p => p.value === value) || null; }
function rangesOverlap(a, b) { return a.s < b.e && a.e > b.s; }
function itemToRange(item) {
  const p = getPeriodRange(item.period);
  if (!p) return null;
  return { s: toMinutes(p.start), e: toMinutes(p.end) };
}
function hasConflict(periods, vehicleId, dateStr) {
  const existing = [...(bookings[vehicleId]||[]), ...(blockedSlots[vehicleId]||[])].filter(b => b.date === dateStr);
  return periods.some(pVal => {
    const newP = getPeriodRange(pVal);
    if (!newP) return false;
    const newRange = { s: toMinutes(newP.start), e: toMinutes(newP.end) };
    return existing.some(item => {
      const r = itemToRange(item);
      return r && rangesOverlap(newRange, r);
    });
  });
}

// ===== 當天整體狀態 =====
function getDayOverallStatus(dateStr) {
  if (!vehicles.length) return 'available';
  const statuses = vehicles.map(v => getVehicleDayStatus((bookings[v.id]||[]).filter(b=>b.date===dateStr), (blockedSlots[v.id]||[]).filter(b=>b.date===dateStr)));
  if (statuses.every(s => s==='full'||s==='blocked')) return 'full';
  if (statuses.some(s => s!=='available')) return 'partial';
  return 'available';
}

function getVehicleDayStatus(dayB, dayBl) {
  const all = [...dayB, ...dayBl];
  if (!all.length) return 'available';
  // 計算已佔用時間
  const ranges = all.map(itemToRange).filter(Boolean);
  const totalMins = 8*60; // 08:00-18:00
  // 用區間合併計算覆蓋率
  const merged = mergeRanges(ranges);
  const covered = merged.reduce((sum, r) => sum + (r.e - r.s), 0);
  if (covered >= totalMins) return 'full';
  if (covered > 0) return 'partial';
  return 'available';
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a,b) => a.s-b.s);
  const merged = [sorted[0]];
  for (let i=1; i<sorted.length; i++) {
    const last = merged[merged.length-1];
    if (sorted[i].s <= last.e) last.e = Math.max(last.e, sorted[i].e);
    else merged.push({...sorted[i]});
  }
  return merged;
}

// ===== 時段標籤 =====
function periodLabel(value) {
  if (value === 'full') return '整天';
  const p = getPeriodRange(value);
  return p ? p.label : value;
}

// ===== 側邊欄 =====
function openSidebar(dateStr) {
  selectedDate = dateStr;
  selectedVehicleIdInSidebar = null;
  const [y,m,d] = dateStr.split('-');
  const dow = ['日','一','二','三','四','五','六'][new Date(dateStr).getDay()];
  document.getElementById('sidebarDate').textContent = `${y}/${parseInt(m)}/${parseInt(d)}（${dow}）`;
  renderSidebar(dateStr);
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
  selectedDate = null;
  selectedVehicleIdInSidebar = null;
}

function renderSidebar(dateStr) {
  if (!selectedVehicleIdInSidebar) renderVehicleList(dateStr);
  else renderVehicleDetail(dateStr, selectedVehicleIdInSidebar);
}

// ===== 車輛列表（側邊欄）=====
function renderVehicleList(dateStr) {
  const body = document.getElementById('sidebarBody');
  if (!vehicles.length) { body.innerHTML = '<div class="empty-state">尚無車輛</div>'; return; }
  let html = '<div class="vehicle-list-label">點選車輛查看詳情或登記</div>';
  vehicles.forEach(v => {
    const vb = (bookings[v.id]||[]).filter(b=>b.date===dateStr);
    const vbl = (blockedSlots[v.id]||[]).filter(b=>b.date===dateStr);
    const status = getVehicleDayStatus(vb, vbl);
    const statusLabel = {available:'可借用',partial:'部分已借',full:'已借滿',blocked:'封鎖中'}[status];
    const statusClass = {available:'status-available',partial:'status-partial',full:'status-full',blocked:'status-blocked'}[status];
    html += `<div class="vehicle-day-card ${statusClass}" data-vid="${v.id}">
      <div class="vdc-info"><div class="vdc-name">${v.name||'未命名'}</div><div class="vdc-plate">${v.plate}</div></div>
      <div class="vdc-status">${statusLabel}</div>
      <div class="vdc-arrow">›</div>
    </div>`;
  });
  body.innerHTML = html;
  body.querySelectorAll('.vehicle-day-card').forEach(card => {
    card.addEventListener('click', () => { selectedVehicleIdInSidebar = card.dataset.vid; renderVehicleDetail(dateStr, card.dataset.vid); });
  });
}

// ===== 車輛詳情（側邊欄）=====
function renderVehicleDetail(dateStr, vehicleId) {
  const body = document.getElementById('sidebarBody');
  const vehicle = vehicles.find(v=>v.id===vehicleId);
  const dayBookings = (bookings[vehicleId]||[]).filter(b=>b.date===dateStr);
  const dayBlocked = (blockedSlots[vehicleId]||[]).filter(b=>b.date===dateStr);

  // 已佔用時段
  const occupiedPeriods = new Set([...dayBookings,...dayBlocked].map(b=>b.period));

  let recordsHtml = '';
  dayBlocked.forEach(bl => {
    recordsHtml += `<div class="booking-item blocked-item">
      <div class="booking-info">
        <div class="booking-period">🔒 ${periodLabel(bl.period)}</div>
        <div class="booking-name">${bl.reason||'（無說明）'}</div>
      </div>
      ${adminLevel?`<button class="booking-delete" data-id="${bl.id}" data-type="blocked">✕</button>`:''}
    </div>`;
  });
  dayBookings.forEach(bk => {
    const timeStr = bk.created_at ? new Date(bk.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    recordsHtml += `<div class="booking-item">
      <div class="booking-info">
        <div class="booking-period">${periodLabel(bk.period)}</div>
        <div class="booking-row"><span class="booking-name">${bk.user_name}</span><span class="booking-purpose">${bk.purpose}</span></div>
        <div class="booking-time">${timeStr} 登記</div>
      </div>
      ${adminLevel?`<button class="booking-delete" data-id="${bk.id}" data-type="booking">✕</button>`:''}
    </div>`;
  });
  if (!recordsHtml) recordsHtml = '<div class="empty-state">此日期尚無預約</div>';

  // 時段選項
  const periodOptionsHtml = PERIODS.map(p => {
    const disabled = p.value !== 'full'
      ? isConflictWithExisting(p.value, [...dayBookings,...dayBlocked])
      : isConflictWithExisting('full', [...dayBookings,...dayBlocked]);
    return `<label class="period-opt checkbox-opt${disabled?' disabled':''}">
      <input type="checkbox" name="period" value="${p.value}" ${disabled?'disabled':''}>
      <span>${p.label}</span>
    </label>`;
  }).join('');

  body.innerHTML = `
    <button class="back-to-list-btn" id="backToList">← 返回車輛列表</button>
    <div class="vehicle-detail-header">
      <span class="vdh-name">${vehicle?.name||''}</span>
      <span class="vdh-plate">${vehicle?.plate||''}</span>
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
        <label>時段 <span class="form-hint">跨時段需分別勾選</span></label>
        <div class="period-options period-checkbox">${periodOptionsHtml}</div>
      </div>
      <button class="btn btn-primary btn-block" id="submitBooking">確認預約</button>
    </div>
  `;

  document.getElementById('backToList')?.addEventListener('click', () => { selectedVehicleIdInSidebar = null; renderVehicleList(dateStr); });
  document.getElementById('lookupEmp')?.addEventListener('click', lookupEmployee);
  document.getElementById('empId')?.addEventListener('keydown', e => { if(e.key==='Enter') lookupEmployee(); });
  document.getElementById('submitBooking')?.addEventListener('click', submitBooking);
  body.querySelectorAll('.booking-delete').forEach(btn => { btn.addEventListener('click', () => deleteRecord(btn.dataset.id, btn.dataset.type)); });

  // 整天勾選時互斥
  body.querySelectorAll('input[name="period"]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.value === 'full' && input.checked) {
        body.querySelectorAll('input[name="period"]').forEach(other => { if (other.value !== 'full') other.checked = false; });
      } else if (input.value !== 'full' && input.checked) {
        const fullInput = body.querySelector('input[name="period"][value="full"]');
        if (fullInput) fullInput.checked = false;
      }
    });
  });
}

// ===== 衝突檢查（單一時段）=====
function isConflictWithExisting(periodValue, existingItems) {
  const newP = getPeriodRange(periodValue);
  if (!newP) return false;
  const newRange = { s: toMinutes(newP.start), e: toMinutes(newP.end) };
  return existingItems.some(item => {
    const r = itemToRange(item);
    return r && rangesOverlap(newRange, r);
  });
}

// ===== 員工查詢 =====
function lookupEmployee() {
  const empId = document.getElementById('empId')?.value.trim();
  if (!empId) return;
  const emp = employees.find(e => e.employee_id === empId);
  if (emp) { document.getElementById('userName').value = emp.name; showToast(`找到：${emp.name}`, 'success'); }
  else showToast('找不到此員工編號', 'error');
}

// ===== 新增預約 =====
async function submitBooking() {
  const selectedPeriods = [...document.querySelectorAll('input[name="period"]:checked')].map(i => i.value);
  const userName = document.getElementById('userName')?.value.trim();
  const purpose = document.getElementById('userPurpose')?.value.trim();
  if (!selectedPeriods.length) { showToast('請勾選時段', 'error'); return; }
  if (!userName) { showToast('請輸入姓名', 'error'); return; }
  if (!purpose) { showToast('請輸入用途', 'error'); return; }
  if (hasConflict(selectedPeriods, selectedVehicleIdInSidebar, selectedDate)) { showToast('所選時段與現有預約衝突', 'error'); return; }

  const btn = document.getElementById('submitBooking');
  btn.disabled = true; btn.textContent = '處理中...';

  const inserts = selectedPeriods.map(p => ({
    vehicle_id: selectedVehicleIdInSidebar, date: selectedDate, period: p, user_name: userName, purpose
  }));
  const { error } = await db.from('bookings').insert(inserts);
  btn.disabled = false; btn.textContent = '確認預約';
  if (error) { showToast('預約失敗，請重試', 'error'); return; }
  showToast('預約成功！', 'success');
  await loadMonthData(); await loadAllBookings();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 刪除紀錄 =====
async function deleteRecord(id, type) {
  const table = type==='booking' ? 'bookings' : 'blocked_slots';
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) { showToast('刪除失敗', 'error'); return; }
  showToast('已刪除', 'success');
  await loadMonthData(); await loadAllBookings();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 登記紀錄列表 =====
function renderBookingLog() {
  const el = document.getElementById('bookingLog');
  if (!el) return;
  if (!allBookings.length) { el.innerHTML = '<div class="log-empty">尚無登記紀錄</div>'; return; }
  const weekdays = ['日','一','二','三','四','五','六'];
  el.innerHTML = allBookings.map(b => {
    const vehicle = b.vehicles || {};
    const dow = weekdays[new Date(b.date).getDay()];
    const timeStr = b.created_at ? new Date(b.created_at).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="log-item">
      <div class="log-left"><div class="log-date">${b.date}</div><div class="log-dow">（${dow}）</div></div>
      <div class="log-right">
        <div class="log-row1">
          <span class="log-name">${b.user_name}</span>
          <span class="log-purpose">${b.purpose}</span>
          <span class="log-period">${periodLabel(b.period)}</span>
          <span class="log-plate">${vehicle.plate||''}</span>
        </div>
        <div class="log-row2">${timeStr} 登記</div>
      </div>
    </div>`;
  }).join('');
}

// ===== 車輛管理 =====
function renderVehicleManagement() {
  const section = document.getElementById('vehicleMgmt');
  if (!section) return;
  section.style.display = adminLevel ? 'block' : 'none';
  if (!adminLevel) return;
  const list = document.getElementById('vehicleMgmtList');
  list.innerHTML = vehicles.map(v => `
    <div class="mgmt-item">
      <span class="mgmt-name">${v.name||'未命名'}</span>
      <span class="mgmt-plate">${v.plate}</span>
      <button class="mgmt-delete" data-id="${v.id}">刪除</button>
    </div>`).join('') || '<div class="empty-state">尚無車輛</div>';
  list.querySelectorAll('.mgmt-delete').forEach(btn => { btn.addEventListener('click', () => deleteVehicle(btn.dataset.id)); });
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

// ===== 封鎖面板 =====
function openBlockPanel() {
  document.getElementById('blockPanel').classList.add('open');
  document.getElementById('blockPanelOverlay').classList.add('open');
  renderBlockVehicleCheckboxes();
}
function closeBlockPanel() {
  document.getElementById('blockPanel').classList.remove('open');
  document.getElementById('blockPanelOverlay').classList.remove('open');
}
function renderBlockVehicleCheckboxes() {
  const el = document.getElementById('blockVehicleList');
  el.innerHTML = `<label class="period-opt checkbox-opt">
    <input type="checkbox" id="blockAllVehicles"> <span>所有車輛</span>
  </label>` + vehicles.map(v => `
    <label class="period-opt checkbox-opt">
      <input type="checkbox" class="block-vehicle-cb" value="${v.id}">
      <span>${v.name} ${v.plate}</span>
    </label>`).join('');
  document.getElementById('blockAllVehicles').addEventListener('change', e => {
    document.querySelectorAll('.block-vehicle-cb').forEach(cb => cb.checked = e.target.checked);
  });
}

async function submitBlock() {
  const date = document.getElementById('blockDate').value;
  const period = document.querySelector('input[name="blockPeriod"]:checked')?.value;
  const reason = document.getElementById('blockReason').value.trim();
  const selectedVehicles = [...document.querySelectorAll('.block-vehicle-cb:checked')].map(cb => cb.value);
  if (!date) { showToast('請選擇日期', 'error'); return; }
  if (!period) { showToast('請選擇封鎖時段', 'error'); return; }
  if (!selectedVehicles.length) { showToast('請選擇車輛', 'error'); return; }

  const btn = document.getElementById('submitBlockBtn');
  btn.disabled = true; btn.textContent = '處理中...';

  const inserts = selectedVehicles.map(vid => ({ vehicle_id: vid, date, period, reason: reason||null }));
  const { error } = await db.from('blocked_slots').insert(inserts);
  btn.disabled = false; btn.textContent = '確認封鎖';
  if (error) { showToast('封鎖失敗', 'error'); return; }
  showToast('封鎖完成', 'success');
  closeBlockPanel();
  await loadMonthData();
}

// ===== 匯出面板 =====
function openExportPanel() {
  document.getElementById('exportPanel').classList.add('open');
  document.getElementById('exportPanelOverlay').classList.add('open');
  renderExportMonths();
}
function closeExportPanel() {
  document.getElementById('exportPanel').classList.remove('open');
  document.getElementById('exportPanelOverlay').classList.remove('open');
}
function renderExportMonths() {
  const el = document.getElementById('exportMonthList');
  const months = [];
  const now = new Date();
  // 列出近12個月
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  el.innerHTML = months.map(m => `
    <label class="period-opt checkbox-opt">
      <input type="checkbox" class="export-month-cb" value="${m.year}-${String(m.month).padStart(2,'0')}">
      <span>${m.year} 年 ${m.month} 月</span>
    </label>`).join('');
}

async function submitExport() {
  const selectedMonths = [...document.querySelectorAll('.export-month-cb:checked')].map(cb => cb.value);
  if (!selectedMonths.length) { showToast('請選擇匯出月份', 'error'); return; }

  const vehicleIds = vehicles.map(v => v.id);
  const allData = [];
  for (const ym of selectedMonths) {
    const [y, m] = ym.split('-');
    const startDate = `${y}-${m}-01`;
    const endDate = new Date(parseInt(y), parseInt(m), 0).toISOString().split('T')[0];
    const { data } = await db.from('bookings').select('*, vehicles(name, plate)').in('vehicle_id', vehicleIds).gte('date', startDate).lte('date', endDate).order('date').order('created_at');
    if (data) allData.push(...data);
  }

  if (!allData.length) { showToast('所選期間無資料', 'error'); return; }
  const weekdays = ['日','一','二','三','四','五','六'];
  const rows = [['日期','星期','車輛名稱','車牌','時段','姓名','用途','登記時間']];
  allData.forEach(b => {
    const dow = weekdays[new Date(b.date).getDay()];
    const time = b.created_at ? new Date(b.created_at).toLocaleString('zh-TW') : '';
    rows.push([b.date, dow, b.vehicles?.name||'', b.vehicles?.plate||'', periodLabel(b.period), b.user_name, b.purpose, time]);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `公務車紀錄_${FIXED_OFFICE_NAME}_${selectedMonths.join('_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('匯出成功', 'success');
  closeExportPanel();
}

// ===== 管理員 =====
function openAdminModal() {
  if (adminLevel) {
    adminLevel = null;
    updateAdminUI();
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
  if (pw === PASSWORDS.admin) {
    adminLevel = 'admin';
    document.getElementById('adminModal').classList.remove('open');
    updateAdminUI();
    showToast('已進入管理員模式', 'success');
  } else {
    document.getElementById('adminError').textContent = '密碼錯誤';
  }
}

function updateAdminUI() {
  const btn = document.getElementById('adminBtn');
  btn.textContent = adminLevel ? '管理員（登出）' : '管理員入口';
  btn.classList.toggle('active', !!adminLevel);
  // 管理員按鈕列
  const adminBar = document.getElementById('adminBar');
  adminBar.style.display = adminLevel ? 'flex' : 'none';
  renderVehicleManagement();
  if (selectedDate && selectedVehicleIdInSidebar) renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== Toast =====
function showToast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = `toast ${type} show`;
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ===== 事件監聽 =====
function setupEventListeners() {
  document.getElementById('prevMonth').addEventListener('click', () => { currentMonth--; if(currentMonth<0){currentMonth=11;currentYear--;} loadMonthData(); });
  document.getElementById('nextMonth').addEventListener('click', () => { currentMonth++; if(currentMonth>11){currentMonth=0;currentYear++;} loadMonthData(); });
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
  document.getElementById('adminBtn').addEventListener('click', openAdminModal);
  document.getElementById('adminConfirmBtn').addEventListener('click', confirmAdmin);
  document.getElementById('adminCancelBtn').addEventListener('click', () => document.getElementById('adminModal').classList.remove('open'));
  document.getElementById('adminPassword').addEventListener('keydown', e => { if(e.key==='Enter') confirmAdmin(); });
  document.getElementById('blockBtn').addEventListener('click', openBlockPanel);
  document.getElementById('blockPanelOverlay').addEventListener('click', closeBlockPanel);
  document.getElementById('blockPanelClose').addEventListener('click', closeBlockPanel);
  document.getElementById('submitBlockBtn').addEventListener('click', submitBlock);
  document.getElementById('exportBtn').addEventListener('click', openExportPanel);
  document.getElementById('exportPanelOverlay').addEventListener('click', closeExportPanel);
  document.getElementById('exportPanelClose').addEventListener('click', closeExportPanel);
  document.getElementById('submitExportBtn').addEventListener('click', submitExport);
  document.getElementById('addVehicleBtn').addEventListener('click', addVehicle);
  document.getElementById('vehicleMgmtBtn').addEventListener('click', () => {
    const section = document.getElementById('vehicleMgmt');
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  });
}

// ===== 啟動 =====
init();
