// ===== Supabase 設定 =====
const SUPABASE_URL = 'https://ioftnuhttlzkcbxlnsvp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvZnRudWh0dGx6a2NieGxuc3ZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyMzIwNDcsImV4cCI6MjA5MTgwODA0N30.d4JzELooUvKMwxMgbZPBV5TxsVAR1kVOSEME_jFwJ2o';

const PASSWORDS = { admin: 'super888' };
const FIXED_OFFICE_NAME = '新北';

const PERIODS = [
  { value: 'full', label: '整天',       start: '08:00', end: '18:00' },
  { value: 'am1',  label: '08:00–10:00', start: '08:00', end: '10:00' },
  { value: 'am2',  label: '10:00–12:30', start: '10:00', end: '12:30' },
  { value: 'pm1',  label: '12:30–15:00', start: '12:30', end: '15:00' },
  { value: 'pm2',  label: '15:00–18:00', start: '15:00', end: '18:00' },
];

const BLOCK_REASONS = ['車輛保養'];

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let vehicles = [], employees = [];
let bookings = {}, blockedSlots = {}, allBookings = [];
let selectedOfficeId = null;
let selectedDate = null, selectedVehicleIdInSidebar = null;
let currentYear = new Date().getFullYear(), currentMonth = new Date().getMonth();
let adminLevel = null, realtimeChannel = null;

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

async function loadFixedOffice() {
  const { data } = await db.from('offices').select('*').eq('name', FIXED_OFFICE_NAME).single();
  if (data) { selectedOfficeId = data.id; document.getElementById('currentOfficeName').textContent = data.name; }
}

async function loadEmployees() {
  const { data } = await db.from('employees').select('*');
  employees = data || [];
}

async function loadVehicles() {
  const { data } = await db.from('vehicles').select('*').eq('office_id', selectedOfficeId).order('plate');
  vehicles = data || [];
}

async function loadMonthData() {
  const startDate = new Date(currentYear, currentMonth, 1).toISOString().split('T')[0];
  const endDate = new Date(currentYear, currentMonth + 1, 0).toISOString().split('T')[0];
  const ids = vehicles.map(v => v.id);
  if (!ids.length) { bookings = {}; blockedSlots = {}; renderCalendar(); return; }
  const [b, bl] = await Promise.all([
    db.from('bookings').select('*').in('vehicle_id', ids).gte('date', startDate).lte('date', endDate),
    db.from('blocked_slots').select('*').in('vehicle_id', ids).gte('date', startDate).lte('date', endDate)
  ]);
  bookings = {}; blockedSlots = {};
  (b.data||[]).forEach(i => { if (!bookings[i.vehicle_id]) bookings[i.vehicle_id]=[]; bookings[i.vehicle_id].push(i); });
  (bl.data||[]).forEach(i => { if (!blockedSlots[i.vehicle_id]) blockedSlots[i.vehicle_id]=[]; blockedSlots[i.vehicle_id].push(i); });
  renderCalendar();
  if (selectedDate) renderSidebar(selectedDate);
}

async function loadAllBookings() {
  const ids = vehicles.map(v => v.id);
  if (!ids.length) { allBookings = []; renderBookingLog(); return; }
  const { data } = await db.from('bookings').select('*, vehicles(plate)').in('vehicle_id', ids).order('date', { ascending: false }).order('created_at', { ascending: false });
  allBookings = data || [];
  renderBookingLog();
}

function subscribeRealtime() {
  if (realtimeChannel) db.removeChannel(realtimeChannel);
  realtimeChannel = db.channel('car-rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings' }, () => { loadMonthData(); loadAllBookings(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'blocked_slots' }, () => { loadMonthData(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => { loadVehicles().then(() => { loadMonthData(); loadAllBookings(); }); })
    .subscribe();
}

// ===== 時段工具 =====
function toMinutes(t) { if (!t) return 0; const [h,m] = t.split(':').map(Number); return h*60+(m||0); }
function getPeriod(v) { return PERIODS.find(p => p.value === v); }
function periodToRange(v) { const p = getPeriod(v); return p ? { s: toMinutes(p.start), e: toMinutes(p.end) } : null; }
function rangesOverlap(a, b) { return a.s < b.e && a.e > b.s; }
function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const s = [...ranges].sort((a,b) => a.s-b.s);
  const m = [s[0]];
  for (let i=1; i<s.length; i++) { const l=m[m.length-1]; if(s[i].s<=l.e) l.e=Math.max(l.e,s[i].e); else m.push({...s[i]}); }
  return m;
}
function minutesToTime(m) { return `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`; }

function periodLabel(v) {
  if (v === 'full') return '整天';
  const p = getPeriod(v);
  return p ? p.label : v;
}

// ===== 燈號判斷 =====
const DAY_START = toMinutes('08:00');
const DAY_END   = toMinutes('18:00');
const DAY_TOTAL = DAY_END - DAY_START; // 600分鐘

// 單一車輛：計算可用分鐘數
function vehicleAvailableMinutes(dayB, dayBl) {
  const ranges = [...dayB, ...dayBl].map(i => periodToRange(i.period)).filter(Boolean);
  const merged = mergeRanges(ranges);
  const covered = merged.reduce((s, r) => s + (Math.min(r.e, DAY_END) - Math.max(r.s, DAY_START)), 0);
  return DAY_TOTAL - Math.max(0, covered);
}

// 判斷整天是否完全空閒
function vehicleIsFullyFree(dayB, dayBl) {
  return vehicleAvailableMinutes(dayB, dayBl) >= DAY_TOTAL;
}

// 整體狀態：有任一車完全空閒→綠，否則有任一車有部分空閒→黃，全滿→紅
function getDayOverallStatus(dateStr) {
  if (!vehicles.length) return 'available';
  const statuses = vehicles.map(v => {
    const vb = (bookings[v.id]||[]).filter(b=>b.date===dateStr);
    const vbl = (blockedSlots[v.id]||[]).filter(b=>b.date===dateStr);
    return getVehicleDayStatus(vb, vbl);
  });
  if (statuses.some(s => s === 'available')) return 'available';
  if (statuses.some(s => s === 'partial')) return 'partial';
  return 'full';
}

function getVehicleDayStatus(dayB, dayBl) {
  const avail = vehicleAvailableMinutes(dayB, dayBl);
  if (avail >= DAY_TOTAL) return 'available';
  if (avail > 0) return 'partial';
  return 'full';
}

// 判斷是否封鎖（用於側邊欄顯示封鎖標籤）
function isVehicleBlocked(dayBl) {
  return dayBl.length > 0;
}

// ===== 月曆 =====
function renderCalendar() {
  document.getElementById('calendarTitle').textContent = `${currentYear} 年 ${currentMonth + 1} 月`;
  const grid = document.getElementById('calendarGrid');
  const wd = ['日','一','二','三','四','五','六'];
  let html = wd.map(d=>`<div class="calendar-weekday">${d}</div>`).join('');
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const dim = new Date(currentYear, currentMonth+1, 0).getDate();
  const today = new Date();
  for (let i=0;i<firstDay;i++) html+=`<div class="calendar-day empty"></div>`;
  for (let d=1;d<=dim;d++) {
    const ds = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = today.getFullYear()===currentYear&&today.getMonth()===currentMonth&&today.getDate()===d;
    const isPast = new Date(currentYear,currentMonth,d)<new Date(today.getFullYear(),today.getMonth(),today.getDate());
    const status = getDayOverallStatus(ds);
    const dotClass = {available:'available',partial:'partial',full:'full'}[status]||'full';
    const dot = isPast?'':` <div class="day-dots"><span class="dot-small ${dotClass}"></span></div>`;
    html+=`<div class="calendar-day ${isToday?'today':''} ${isPast?'past':''}" data-date="${ds}"><span class="day-num">${d}</span>${dot}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll('.calendar-day:not(.empty):not(.past)').forEach(el=>{
    el.addEventListener('click',()=>openSidebar(el.dataset.date));
  });
}

// ===== 側邊欄 =====
function openSidebar(dateStr) {
  selectedDate = dateStr; selectedVehicleIdInSidebar = null;
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
  selectedDate = null; selectedVehicleIdInSidebar = null;
}

function renderSidebar(dateStr) {
  if (!selectedVehicleIdInSidebar) renderVehicleList(dateStr);
  else renderVehicleDetail(dateStr, selectedVehicleIdInSidebar);
}

function renderVehicleList(dateStr) {
  const body = document.getElementById('sidebarBody');
  if (!vehicles.length) { body.innerHTML='<div class="empty-state">尚無車輛</div>'; return; }
  let html = '<div class="vehicle-list-label">點選車輛查看詳情或登記</div>';
  vehicles.forEach(v => {
    const vb = (bookings[v.id]||[]).filter(b=>b.date===dateStr);
    const vbl = (blockedSlots[v.id]||[]).filter(b=>b.date===dateStr);
    const status = getVehicleDayStatus(vb, vbl);
    const hasBlock = isVehicleBlocked(vbl);
    const statusLabel = {available:'有空餘',partial:'零星時段',full:'無空車'}[status];
    const statusClass = {available:'status-available',partial:'status-partial',full:'status-full'}[status];
    const blockBadge = hasBlock ? '<span class="block-badge">封鎖中</span>' : '';
    html+=`<div class="vehicle-day-card ${statusClass}" data-vid="${v.id}">
      <div class="vdc-info"><div class="vdc-plate">${v.plate}</div>${blockBadge}</div>
      <div class="vdc-status">${statusLabel}</div>
      <div class="vdc-arrow">›</div>
    </div>`;
  });
  body.innerHTML = html;
  body.querySelectorAll('.vehicle-day-card').forEach(card=>{
    card.addEventListener('click',()=>{ selectedVehicleIdInSidebar=card.dataset.vid; renderVehicleDetail(dateStr,card.dataset.vid); });
  });
}

function renderVehicleDetail(dateStr, vehicleId) {
  const body = document.getElementById('sidebarBody');
  const vehicle = vehicles.find(v=>v.id===vehicleId);
  const dayBookings = (bookings[vehicleId]||[]).filter(b=>b.date===dateStr);
  const dayBlocked = (blockedSlots[vehicleId]||[]).filter(b=>b.date===dateStr);
  const allItems = [...dayBookings,...dayBlocked];

  let recordsHtml = '';
  dayBlocked.forEach(bl=>{
    recordsHtml+=`<div class="booking-item blocked-item">
      <div class="booking-info">
        <div class="booking-period">🔒 ${periodLabel(bl.period)}</div>
        <div class="booking-name">${bl.reason||'（無說明）'}</div>
      </div>
      ${adminLevel?`<button class="booking-delete" data-id="${bl.id}" data-type="blocked">✕</button>`:''}
    </div>`;
  });
  dayBookings.forEach(bk=>{
    const timeStr = bk.created_at ? formatDateTime24(bk.created_at) : '';
    recordsHtml+=`<div class="booking-item">
      <div class="booking-info">
        <div class="booking-period">${periodLabel(bk.period)}</div>
        <div class="booking-row"><span class="booking-name">${bk.user_name}</span><span class="booking-purpose">${bk.purpose}</span></div>
        <div class="booking-time">${timeStr} 登記</div>
      </div>
      ${adminLevel?`<button class="booking-delete" data-id="${bk.id}" data-type="booking">✕</button>`:''}
    </div>`;
  });
  if (!recordsHtml) recordsHtml='<div class="empty-state">此日期尚無預約</div>';

  const periodOptionsHtml = PERIODS.map(p=>{
    const disabled = isConflictWithExisting(p.value, allItems);
    return `<label class="period-opt checkbox-opt${disabled?' disabled':''}">
      <input type="checkbox" name="period" value="${p.value}" ${disabled?'disabled':''}><span>${p.label}</span>
    </label>`;
  }).join('');

  body.innerHTML=`
    <button class="back-to-list-btn" id="backToList">← 返回車輛列表</button>
    <div class="vehicle-detail-header"><span class="vdh-plate">${vehicle?.plate||''}</span></div>
    <div class="booking-list">${recordsHtml}</div>
    <div class="booking-form">
      <div class="form-title">新增預約</div>
      <div class="form-group">
        <label>員工編號</label>
        <div class="emp-row"><input type="text" class="form-input" id="empId" placeholder="輸入員工編號"><button class="btn btn-ghost btn-sm" id="lookupEmp">查詢</button></div>
      </div>
      <div class="form-group"><label>姓名</label><input type="text" class="form-input" id="userName" placeholder="請輸入姓名"></div>
      <div class="form-group"><label>用途 / 專案名</label><input type="text" class="form-input" id="userPurpose" placeholder="請輸入用途或專案名稱"></div>
      <div class="form-group">
        <label>時段 <span class="form-hint">跨時段需分別勾選</span></label>
        <div class="period-options period-checkbox">${periodOptionsHtml}</div>
      </div>
      <button class="btn btn-primary btn-block" id="submitBooking">確認預約</button>
    </div>`;

  document.getElementById('backToList')?.addEventListener('click',()=>{ selectedVehicleIdInSidebar=null; renderVehicleList(dateStr); });
  document.getElementById('lookupEmp')?.addEventListener('click', lookupEmployee);
  document.getElementById('empId')?.addEventListener('keydown', e=>{ if(e.key==='Enter') lookupEmployee(); });
  document.getElementById('submitBooking')?.addEventListener('click', submitBooking);
  body.querySelectorAll('.booking-delete').forEach(btn=>{ btn.addEventListener('click',()=>deleteRecord(btn.dataset.id,btn.dataset.type)); });

  body.querySelectorAll('input[name="period"]').forEach(input=>{
    input.addEventListener('change',()=>{
      if(input.value==='full'&&input.checked) body.querySelectorAll('input[name="period"]').forEach(o=>{ if(o.value!=='full') o.checked=false; });
      else if(input.value!=='full'&&input.checked) { const fi=body.querySelector('input[name="period"][value="full"]'); if(fi) fi.checked=false; }
    });
  });
}

function isConflictWithExisting(periodValue, existingItems) {
  const newP = getPeriod(periodValue);
  if (!newP) return false;
  const nr = { s: toMinutes(newP.start), e: toMinutes(newP.end) };
  return existingItems.some(item=>{ const r=periodToRange(item.period); return r&&rangesOverlap(nr,r); });
}

// ===== 員工查詢 =====
function lookupEmployee() {
  const id = document.getElementById('empId')?.value.trim();
  if (!id) return;
  const emp = employees.find(e=>e.employee_id===id);
  if (emp) { document.getElementById('userName').value=emp.name; showToast(`找到：${emp.name}`,'success'); }
  else showToast('找不到此員工編號','error');
}

// ===== 新增預約 =====
async function submitBooking() {
  const selected = [...document.querySelectorAll('input[name="period"]:checked')].map(i=>i.value);
  const userName = document.getElementById('userName')?.value.trim();
  const purpose = document.getElementById('userPurpose')?.value.trim();
  if (!selected.length) { showToast('請勾選時段','error'); return; }
  if (!userName) { showToast('請輸入姓名','error'); return; }
  if (!purpose) { showToast('請輸入用途','error'); return; }

  const dayBookings = (bookings[selectedVehicleIdInSidebar]||[]).filter(b=>b.date===selectedDate);
  const dayBlocked = (blockedSlots[selectedVehicleIdInSidebar]||[]).filter(b=>b.date===selectedDate);
  const conflict = selected.some(p=>isConflictWithExisting(p,[...dayBookings,...dayBlocked]));
  if (conflict) { showToast('所選時段與現有預約衝突','error'); return; }

  const btn = document.getElementById('submitBooking');
  btn.disabled=true; btn.textContent='處理中...';
  const inserts = selected.map(p=>({ vehicle_id:selectedVehicleIdInSidebar, date:selectedDate, period:p, user_name:userName, purpose }));
  const { error } = await db.from('bookings').insert(inserts);
  btn.disabled=false; btn.textContent='確認預約';
  if (error) { showToast('預約失敗，請重試','error'); return; }
  showToast('預約成功！','success');
  await loadMonthData(); await loadAllBookings();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 刪除 =====
async function deleteRecord(id, type) {
  const table = type==='booking'?'bookings':'blocked_slots';
  const { error } = await db.from(table).delete().eq('id',id);
  if (error) { showToast('刪除失敗','error'); return; }
  showToast('已刪除','success');
  await loadMonthData(); await loadAllBookings();
  renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== 登記紀錄彙整 =====
function mergeBookings(rawBookings) {
  // 依 date + vehicle_id + user_name + purpose 分組，再合併連續時段
  const groups = {};
  rawBookings.forEach(b => {
    const key = `${b.date}__${b.vehicle_id}__${b.user_name}__${b.purpose}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  });

  const result = [];
  Object.values(groups).forEach(items => {
    // 取得每筆的時間範圍
    const ranges = items.map(i => {
      const r = periodToRange(i.period);
      return r ? { ...r, item: i } : null;
    }).filter(Boolean).sort((a,b) => a.s-b.s);

    // 合併連續區間
    const merged = [];
    ranges.forEach(r => {
      if (!merged.length || r.s > merged[merged.length-1].e) {
        merged.push({ s: r.s, e: r.e, item: r.item });
      } else {
        merged[merged.length-1].e = Math.max(merged[merged.length-1].e, r.e);
      }
    });

    // 每個合併區間產生一筆紀錄
    merged.forEach(m => {
      result.push({
        ...m.item,
        _displayLabel: `${minutesToTime(m.s)}–${minutesToTime(m.e)}`
      });
    });
  });

  // 依 date desc, created_at desc 排序
  result.sort((a,b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  return result;
}

function renderBookingLog() {
  const el = document.getElementById('bookingLog');
  if (!el) return;
  if (!allBookings.length) { el.innerHTML='<div class="log-empty">尚無登記紀錄</div>'; return; }
  const merged = mergeBookings(allBookings);
  const wd = ['日','一','二','三','四','五','六'];
  el.innerHTML = merged.map(b => {
    const vehicle = b.vehicles||{};
    const dow = wd[new Date(b.date).getDay()];
    const timeStr = b.created_at ? formatDateTime24(b.created_at) : '';
    const label = b._displayLabel || periodLabel(b.period);
    return `<div class="log-item">
      <div class="log-left"><div class="log-date">${b.date}</div><div class="log-dow">（${dow}）</div></div>
      <div class="log-right">
        <div class="log-row1">
          <span class="log-name">${b.user_name}</span>
          <span class="log-purpose">${b.purpose}</span>
          <span class="log-period">${label}</span>
          <span class="log-plate">${vehicle.plate||''}</span>
        </div>
        <div class="log-row2">${timeStr} 登記</div>
      </div>
    </div>`;
  }).join('');
}

// ===== 時間格式（24小時）=====
function formatDateTime24(isoStr) {
  const d = new Date(isoStr);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

// ===== 封鎖面板 =====
function openBlockPanel() {
  document.getElementById('blockPanel').classList.add('open');
  document.getElementById('blockPanelOverlay').classList.add('open');
  // 設定預設日期為今天
  document.getElementById('blockDate').value = new Date().toISOString().split('T')[0];
  renderBlockVehicleCheckboxes();
}
function closeBlockPanel() {
  document.getElementById('blockPanel').classList.remove('open');
  document.getElementById('blockPanelOverlay').classList.remove('open');
}
function setBlockReason(reason) {
  document.getElementById('blockReason').value = reason;
}
function renderBlockVehicleCheckboxes() {
  const el = document.getElementById('blockVehicleList');
  el.innerHTML = `<label class="period-opt checkbox-opt"><input type="checkbox" id="blockAllVehicles"><span>所有車輛</span></label>`
    + vehicles.map(v=>`<label class="period-opt checkbox-opt"><input type="checkbox" class="block-vehicle-cb" value="${v.id}"><span>${v.plate}</span></label>`).join('');
  document.getElementById('blockAllVehicles').addEventListener('change', e=>{
    document.querySelectorAll('.block-vehicle-cb').forEach(cb=>cb.checked=e.target.checked);
  });
}
async function submitBlock() {
  const date = document.getElementById('blockDate').value;
  const period = document.querySelector('input[name="blockPeriod"]:checked')?.value;
  const reason = document.getElementById('blockReason').value.trim();
  const selectedV = [...document.querySelectorAll('.block-vehicle-cb:checked')].map(cb=>cb.value);
  if (!date) { showToast('請選擇日期','error'); return; }
  if (!period) { showToast('請選擇封鎖時段','error'); return; }
  if (!selectedV.length) { showToast('請選擇車輛','error'); return; }
  const btn = document.getElementById('submitBlockBtn');
  btn.disabled=true; btn.textContent='處理中...';
  const inserts = selectedV.map(vid=>({ vehicle_id:vid, date, period, reason:reason||null }));
  const { error } = await db.from('blocked_slots').insert(inserts);
  btn.disabled=false; btn.textContent='確認封鎖';
  if (error) { showToast('封鎖失敗','error'); return; }
  showToast('封鎖完成','success');
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
  for (let i=0; i<12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({ year:d.getFullYear(), month:d.getMonth()+1 });
  }
  el.innerHTML = `<label class="period-opt checkbox-opt"><input type="checkbox" id="exportSelectAll"><span>全選</span></label>`
    + months.map(m=>`<label class="period-opt checkbox-opt"><input type="checkbox" class="export-month-cb" value="${m.year}-${String(m.month).padStart(2,'0')}"><span>${m.year}年${m.month}月</span></label>`).join('');
  document.getElementById('exportSelectAll').addEventListener('change', e=>{
    document.querySelectorAll('.export-month-cb').forEach(cb=>cb.checked=e.target.checked);
  });
}
async function submitExport() {
  const selected = [...document.querySelectorAll('.export-month-cb:checked')].map(cb=>cb.value);
  if (!selected.length) { showToast('請選擇匯出月份','error'); return; }
  const ids = vehicles.map(v=>v.id);
  const allData = [];
  for (const ym of selected) {
    const [y,m] = ym.split('-');
    const start = `${y}-${m}-01`;
    const end = new Date(parseInt(y),parseInt(m),0).toISOString().split('T')[0];
    const { data } = await db.from('bookings').select('*, vehicles(plate)').in('vehicle_id',ids).gte('date',start).lte('date',end).order('date').order('created_at');
    if (data) allData.push(...data);
  }
  if (!allData.length) { showToast('所選期間無資料','error'); return; }
  const merged = mergeBookings(allData);
  const wd = ['日','一','二','三','四','五','六'];
  const rows = [['日期','星期','車牌','時段','姓名','用途','登記時間']];
  merged.forEach(b=>{
    const dow = wd[new Date(b.date).getDay()];
    const time = b.created_at ? formatDateTime24(b.created_at) : '';
    const label = b._displayLabel || periodLabel(b.period);
    rows.push([b.date, dow, b.vehicles?.plate||'', label, b.user_name, b.purpose, time]);
  });
  const csv = '\uFEFF'+rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=`公務車紀錄_${FIXED_OFFICE_NAME}_${selected.join('_')}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('匯出成功','success');
  closeExportPanel();
}

// ===== 車輛管理面板 =====
function openVehiclePanel() {
  document.getElementById('vehiclePanel').classList.add('open');
  document.getElementById('vehiclePanelOverlay').classList.add('open');
  renderVehiclePanelList();
}
function closeVehiclePanel() {
  document.getElementById('vehiclePanel').classList.remove('open');
  document.getElementById('vehiclePanelOverlay').classList.remove('open');
}
function renderVehiclePanelList() {
  const el = document.getElementById('vehiclePanelList');
  el.innerHTML = vehicles.map(v=>`
    <div class="mgmt-item">
      <span class="mgmt-plate">${v.plate}</span>
      <button class="mgmt-delete" data-id="${v.id}">刪除</button>
    </div>`).join('')||'<div class="empty-state">尚無車輛</div>';
  el.querySelectorAll('.mgmt-delete').forEach(btn=>{ btn.addEventListener('click',()=>deleteVehicle(btn.dataset.id)); });
}
async function addVehicle() {
  const plate = document.getElementById('newVehiclePlate')?.value.trim();
  if (!plate) { showToast('請填寫車牌','error'); return; }
  const { error } = await db.from('vehicles').insert({ office_id:selectedOfficeId, plate, name:plate });
  if (error) { showToast('新增失敗：'+error.message,'error'); return; }
  document.getElementById('newVehiclePlate').value='';
  showToast('車輛已新增','success');
  await loadVehicles();
  renderVehiclePanelList();
}
async function deleteVehicle(id) {
  const { error } = await db.from('vehicles').delete().eq('id',id);
  if (error) { showToast('刪除失敗','error'); return; }
  showToast('車輛已刪除','success');
  await loadVehicles();
  renderVehiclePanelList();
  await loadMonthData(); await loadAllBookings();
}

// ===== 管理員 =====
function openAdminModal() {
  if (adminLevel) { adminLevel=null; updateAdminUI(); showToast('已登出管理員模式'); return; }
  document.getElementById('adminPassword').value='';
  document.getElementById('adminError').textContent='';
  document.getElementById('adminModal').classList.add('open');
  setTimeout(()=>document.getElementById('adminPassword').focus(),100);
}
function confirmAdmin() {
  const pw = document.getElementById('adminPassword').value.trim();
  if (pw===PASSWORDS.admin) {
    adminLevel='admin';
    document.getElementById('adminModal').classList.remove('open');
    updateAdminUI();
    showToast('已進入管理員模式','success');
  } else { document.getElementById('adminError').textContent='密碼錯誤'; }
}
function updateAdminUI() {
  const btn = document.getElementById('adminBtn');
  btn.textContent = adminLevel ? '管理員（登出）' : '管理員入口';
  btn.classList.toggle('active', !!adminLevel);
  document.getElementById('adminBar').style.display = adminLevel ? 'flex' : 'none';
  if (selectedDate && selectedVehicleIdInSidebar) renderVehicleDetail(selectedDate, selectedVehicleIdInSidebar);
}

// ===== Toast =====
function showToast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent=msg; el.className=`toast ${type} show`;
  setTimeout(()=>el.classList.remove('show'),2500);
}

// ===== 事件監聽 =====
function setupEventListeners() {
  document.getElementById('prevMonth').addEventListener('click',()=>{ currentMonth--; if(currentMonth<0){currentMonth=11;currentYear--;} loadMonthData(); });
  document.getElementById('nextMonth').addEventListener('click',()=>{ currentMonth++; if(currentMonth>11){currentMonth=0;currentYear++;} loadMonthData(); });
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
  document.getElementById('adminBtn').addEventListener('click', openAdminModal);
  document.getElementById('adminConfirmBtn').addEventListener('click', confirmAdmin);
  document.getElementById('adminCancelBtn').addEventListener('click',()=>document.getElementById('adminModal').classList.remove('open'));
  document.getElementById('adminPassword').addEventListener('keydown',e=>{ if(e.key==='Enter') confirmAdmin(); });
  document.getElementById('blockBtn').addEventListener('click', openBlockPanel);
  document.getElementById('blockPanelOverlay').addEventListener('click', closeBlockPanel);
  document.getElementById('blockPanelClose').addEventListener('click', closeBlockPanel);
  document.getElementById('submitBlockBtn').addEventListener('click', submitBlock);
  document.getElementById('exportBtn').addEventListener('click', openExportPanel);
  document.getElementById('exportPanelOverlay').addEventListener('click', closeExportPanel);
  document.getElementById('exportPanelClose').addEventListener('click', closeExportPanel);
  document.getElementById('submitExportBtn').addEventListener('click', submitExport);
  document.getElementById('vehicleMgmtBtn').addEventListener('click', openVehiclePanel);
  document.getElementById('vehiclePanelOverlay').addEventListener('click', closeVehiclePanel);
  document.getElementById('vehiclePanelClose').addEventListener('click', closeVehiclePanel);
  document.getElementById('addVehicleBtn').addEventListener('click', addVehicle);
  document.getElementById('newVehiclePlate').addEventListener('keydown',e=>{ if(e.key==='Enter') addVehicle(); });
}

init();
