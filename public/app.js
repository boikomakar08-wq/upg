(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready(); tg?.expand();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const rarityNames = ['обычное','необычное','редкое','сверхредкое','легендарное','мифическое','???'];
  let selectedAmount = 100, me = null, isAdmin = false, rewardsCache = [], casesCache = [], editingItemImage = null, editingCaseImage = null;
  const toast = (message) => { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2800); };
  async function api(path, options={}) {
    const initData = tg?.initData || '';
    const headers = { 'Content-Type':'application/json', 'X-Telegram-Init-Data':initData, ...(options.headers||{}) };
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос');
    return data;
  }
  function icons(){ if(window.lucide) lucide.createIcons(); }
  function showPage(page) {
    const pages=['home','cases','caseDetail','games','topup','inventory','profile','settings','admin'];
    pages.forEach(p=>$('#'+p+'Page')?.classList.toggle('hidden',p!==page));
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    if(page==='inventory') loadMe();
    if(page==='profile') loadMe();
    if(page==='cases') loadCases();
    if(page==='topup') updateTopupButton();
    if(page==='admin' && isAdmin) refreshAdmin();
    window.scrollTo({top:0,behavior:'smooth'}); icons();
  }
  $$('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));
  $('#profileBtn').addEventListener('click',()=>showPage('profile'));

  function applyTheme(theme){
    const safe=theme==='light'?'light':'dark'; document.body.dataset.theme=safe;
    $('#themeSelect').value=safe;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',safe==='dark'?'#07130e':'#eef6f0');
    try{localStorage.setItem('belivein-theme',safe)}catch{}
  }
  let savedTheme='dark'; try{savedTheme=localStorage.getItem('belivein-theme')||'dark'}catch{}
  applyTheme(savedTheme);
  $('#themeSelect').addEventListener('change',e=>{applyTheme(e.target.value);toast(e.target.value==='light'?'Светлая тема включена':'Тёмная тема включена');});

  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function escapeAttr(v){return escapeHtml(v);}
  function money(v){return Number(v||0).toLocaleString('ru-RU',{maximumFractionDigits:2});}
  function avatarUrl(){return me?.user?.photo_url || tg?.initDataUnsafe?.user?.photo_url || '';}
  function renderAvatar(){
    const user=tg?.initDataUnsafe?.user||{}; const url=avatarUrl();
    $('#topAvatar').classList.toggle('hidden',!url); $('#topAvatarIcon').classList.toggle('hidden',!!url);
    if(url) $('#topAvatar').src=url;
    $('#profileAvatar').classList.toggle('hidden',!url); $('#profileAvatarFallback').classList.toggle('hidden',!!url);
    if(url) $('#profileAvatar').src=url;
    $('#profileName').textContent=me?.user?.first_name || user.first_name || 'Твой профиль';
    $('#profileUsername').textContent=me?.user?.username ? '@'+me.user.username : (user.username?'@'+user.username:'Профиль Telegram');
  }
  function renderInventory(items){
    $('#inventory').innerHTML=items.length?items.map(r=>`<article class="reward-item" style="background:${safeColor(r.reward_background)}">${r.reward_image?`<img class="reward-image" src="${escapeAttr(r.reward_image)}" alt="">`:`<div class="reward-placeholder"><i data-lucide="package-check"></i></div>`}<div class="reward-info"><b>${escapeHtml(r.reward_name)}</b><span>${escapeHtml(r.status||'В коллекции')} · ${escapeHtml(r.reward_rarity||'обычное')}</span></div><span class="price">${money(r.reward_value)} ⭐</span></article>`).join(''):'<div class="empty-state">Здесь появятся предметы, которые ты получишь из кейсов или игр.</div>';
    icons();
  }
  function renderProfile(){
    renderAvatar(); const user=me?.user||{}, stats=me?.stats||{};
    $('#statBalance').textContent=money(me?.balance)+' ⭐'; $('#statItems').textContent=stats.items_owned??(me?.inventory?.length||0);
    $('#statCases').textContent=stats.cases_opened??0; $('#statGames').textContent=stats.games_played??0;
    $('#joinedDate').textContent='В игре с '+(user.created_at?new Date(user.created_at).toLocaleDateString('ru-RU'):'первого входа');
    $('#bestPrizeName').textContent=stats.best_prize_name||'Пока нет призов';
    $('#bestPrizeValue').textContent=stats.best_prize_name?money(stats.best_prize_value)+' ⭐':'Открой первый кейс';
    const best=(me?.inventory||[]).slice().sort((a,b)=>Number(b.reward_value)-Number(a.reward_value))[0];
    $('#bestPrizeImage').innerHTML=best?.reward_image?`<img class="reward-image" src="${escapeAttr(best.reward_image)}" alt="">`:'<i data-lucide="gift"></i>';
    $('#adminOpenBtn').classList.toggle('hidden',!isAdmin); icons();
  }
  async function loadMe(){
    try{me=await api('/api/me');$('#balance').textContent=money(me.balance??me.user?.balance??0);renderInventory(me.inventory||[]);renderProfile();}
    catch(e){$('#balance').textContent='—';if(!tg?.initData) toast('Открой Mini App из Telegram-бота.');}
  }
  function safeColor(color){return /^#[0-9a-f]{6}$/i.test(color||'')?color:'#123c2b';}
  function rewardCard(r){return `<article class="reward-item" style="background:linear-gradient(110deg,${safeColor(r.background_color)}33,var(--panel))">${r.image_url?`<img class="reward-image" src="${escapeAttr(r.image_url)}" alt="">`:`<div class="reward-placeholder"><i data-lucide="gift"></i></div>`}<div class="reward-info"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.description||'Предмет коллекции')}</span><span class="rarity">${escapeHtml(r.rarity||'обычное')}</span></div><span class="price">${money(r.value)} ⭐</span></article>`;}
  async function loadRewards(){
    try{rewardsCache=await api('/api/rewards');$('#rewardCount').textContent=rewardsCache.length;$('#rewards').innerHTML=rewardsCache.length?rewardsCache.map(rewardCard).join(''):'<div class="empty-state">Пока нет предметов. Загляни позже.</div>';
      $('#upgradeReward').innerHTML=rewardsCache.map(r=>`<option value="${r.id}">${escapeHtml(r.name)} — ${money(r.value)} ⭐</option>`).join('')||'<option value="">Нет предметов</option>';icons();
    }catch(e){$('#rewards').innerHTML='<p class="muted">Не удалось загрузить предметы.</p>';}
  }
  function caseCard(c){return `<article class="case-card" data-case-id="${c.id}" style="--case-bg:${safeColor(c.background_color)}"><div class="case-art">${c.image_url?`<img src="${escapeAttr(c.image_url)}" alt="">`:'<i class="case-glyph" data-lucide="package-open"></i>'}</div><div class="case-meta"><b>${escapeHtml(c.name)}</b><p>${escapeHtml(c.description||`${c.item_count||0} предметов внутри`)}</p><div class="case-bottom"><span class="case-price">${money(c.price)} ⭐</span><button class="mini-btn" data-open-case="${c.id}">Открыть</button></div></div></article>`;}
  async function loadCases(){
    try{casesCache=await api('/api/cases');const html=casesCache.length?casesCache.map(caseCard).join(''):'<div class="empty-state">Кейсов пока нет.</div>';$('#casesList').innerHTML=html;$('#homeCases').innerHTML=casesCache.slice(0,4).map(caseCard).join('')||'<div class="empty-state">Кейсы скоро появятся.</div>';icons();
    }catch(e){$('#casesList').innerHTML='<div class="empty-state">Не удалось загрузить кейсы.</div>';$('#homeCases').innerHTML='';}
  }
  async function showCase(id){
    showPage('caseDetail'); $('#caseDetail').innerHTML='<div class="loading">Загружаем кейс…</div>';
    try{const data=await api('/api/cases/'+id);const c=data.case;
      $('#caseDetail').innerHTML=`<div class="detail-hero" style="--case-bg:${safeColor(c.background_color)}">${c.image_url?`<img src="${escapeAttr(c.image_url)}" alt="">`:'<i class="case-glyph" data-lucide="package-open"></i>'}<h2>${escapeHtml(c.name)}</h2><p class="muted">${escapeHtml(c.description||'Содержимое кейса')}</p><b>${money(c.price)} ⭐</b></div><h3 class="subheading">Содержимое кейса</h3><div class="detail-items">${data.items.map(r=>`<article class="detail-item" style="--item-bg:${safeColor(r.background_color)}">${r.image_url?`<img src="${escapeAttr(r.image_url)}" alt="">`:'<div class="reward-placeholder"><i data-lucide="gift"></i></div>'}<b>${escapeHtml(r.name)}</b><span class="rarity">${escapeHtml(r.rarity||'обычное')}</span><span>${money(r.value)} ⭐</span><span class="chance-badge">Шанс: ${money(r.visual_chance)}%</span></article>`).join('')||'<div class="empty-state">В кейсе ещё нет предметов.</div>'}</div><button class="primary-btn" id="openCaseNow" ${data.items.length?'':'disabled'}>Открыть за ${money(c.price)} ⭐ <i data-lucide="sparkles"></i></button><div id="caseOpenResult" class="result-box hidden"></div>`;
      $('#openCaseNow')?.addEventListener('click',async()=>{const btn=$('#openCaseNow');btn.disabled=true;try{const result=await api(`/api/cases/${id}/open`,{method:'POST',body:'{}'});$('#caseOpenResult').classList.remove('hidden');$('#caseOpenResult').innerHTML=`<img src="${escapeAttr(result.reward.image_url||'')}" alt="" style="${result.reward.image_url?'':'display:none'}"><div style="text-align:center"><b>Выпал предмет: ${escapeHtml(result.reward.name)}</b><p>${money(result.reward.value)} ⭐ · ${escapeHtml(result.reward.rarity||'обычное')}</p></div>`;toast('Кейс открыт!');await loadMe();}catch(e){toast(e.message);}finally{btn.disabled=false;}});icons();
    }catch(e){$('#caseDetail').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;}
  }
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-open-case]');const card=e.target.closest('[data-case-id]');const id=btn?.dataset.openCase||card?.dataset.caseId;if(id)showCase(id);});

  $$('.pack').forEach(b=>b.addEventListener('click',()=>{$$('.pack').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedAmount=Number(b.dataset.amount);$('#customAmount').value='';updateTopupButton();}));
  $('#customAmount').addEventListener('input',()=>{$$('.pack').forEach(x=>x.classList.remove('selected'));selectedAmount=Number($('#customAmount').value)||0;updateTopupButton();});
  function updateTopupButton(){const amount=Number($('#customAmount').value)||selectedAmount;$('#topupBtn').innerHTML=`Пополнить на ${amount>0?amount:0} ⭐ <i data-lucide="arrow-right"></i>`;icons();}
  $('#topupBtn').addEventListener('click',async()=>{const amount=Number($('#customAmount').value)||selectedAmount;if(!Number.isInteger(amount)||amount<1||amount>10000){toast('Укажи сумму от 1 до 10 000 ⭐');return;}if(!tg?.initData){toast('Открой приложение через Telegram-бота для оплаты.');return;}const btn=$('#topupBtn');btn.disabled=true;try{const result=await api('/api/topup',{method:'POST',body:JSON.stringify({amount})});if(!result.invoiceLink)throw new Error('Сервер не вернул ссылку оплаты');tg.openInvoice(result.invoiceLink,status=>{if(status==='paid'){toast('Оплата прошла! Баланс обновится после подтверждения.');setTimeout(loadMe,900);}else if(status==='cancelled')toast('Оплата отменена.');else if(status==='failed')toast('Не удалось провести оплату.');});}catch(e){toast(e.message==='Failed to fetch'?'Не удалось связаться с сервером.':e.message);}finally{btn.disabled=false;}});
  $('#upgradeBtn').addEventListener('click',async()=>{const rewardId=Number($('#upgradeReward').value),stake=Number($('#upgradeStake').value);if(!rewardId||!Number.isFinite(stake)||stake<=0){toast('Выбери предмет и укажи ставку');return;}const btn=$('#upgradeBtn');btn.disabled=true;$('#upgradeResult').classList.add('hidden');try{const r=await api('/api/upgrade',{method:'POST',body:JSON.stringify({rewardId,stake})});$('#upgradeResult').classList.remove('hidden');$('#upgradeResult').innerHTML=`<div style="text-align:center"><b>${r.won?'Успех! Ты получил предмет 🎉':'В этот раз не повезло'}</b><p>${escapeHtml(r.reward.name)} · шанс апгрейда ${money(r.chance)}%</p></div>`;await loadMe();}catch(e){toast(e.message);}finally{btn.disabled=false;}});

  async function imageData(file){
    if(!file)return null;if(!file.type.startsWith('image/'))throw new Error('Выбери файл изображения');
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Не удалось прочитать картинку'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('Файл не является корректным изображением'));img.onload=()=>{const max=1000,scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.82);if(data.length>1400000)return reject(new Error('Картинка слишком большая, выбери файл поменьше'));resolve(data);};img.src=reader.result;};reader.readAsDataURL(file);});
  }
  function previewFile(input,preview){input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file){preview.classList.add('hidden');return;}try{const data=await imageData(file);preview.innerHTML=`<img src="${data}" alt="Предпросмотр">`;preview.classList.remove('hidden');}catch(e){toast(e.message);input.value='';}});}
  previewFile($('#itemImage'),$('#itemImagePreview'));previewFile($('#caseImage'),$('#caseImagePreview'));
  function resetItemForm(){editingItemImage=null;$('#itemForm').reset();$('#itemId').value='';$('#itemBackground').value='#123c2b';$('#itemFormTitle').textContent='Создать предмет';$('#itemCancelEdit').classList.add('hidden');$('#itemImagePreview').classList.add('hidden');$('#itemImagePreview').innerHTML='';$('#itemRarity').value='обычное';}
  function resetCaseForm(){editingCaseImage=null;$('#caseForm').reset();$('#caseId').value='';$('#caseBackground').value='#123c2b';$('#caseFormTitle').textContent='Создать кейс';$('#caseCancelEdit').classList.add('hidden');$('#caseImagePreview').classList.add('hidden');$('#caseImagePreview').innerHTML='';}
  $('#itemCancelEdit').addEventListener('click',resetItemForm);$('#caseCancelEdit').addEventListener('click',resetCaseForm);
  $('#itemForm').addEventListener('submit',async e=>{e.preventDefault();try{const file=$('#itemImage').files?.[0];const payload={name:$('#itemName').value.trim(),description:$('#itemDescription').value.trim(),value:Number($('#itemValue').value),rarity:$('#itemRarity').value,background_color:$('#itemBackground').value,image_url:file?await imageData(file):editingItemImage};const id=$('#itemId').value;await api(id?`/api/admin/items/${id}`:'/api/admin/items',{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'Предмет обновлён':'Предмет создан');resetItemForm();await refreshAdmin();await loadRewards();}catch(err){toast(err.message);}});
  $('#caseForm').addEventListener('submit',async e=>{e.preventDefault();try{const file=$('#caseImage').files?.[0];const payload={name:$('#caseName').value.trim(),description:$('#caseDescription').value.trim(),price:Number($('#casePrice').value),background_color:$('#caseBackground').value,image_url:file?await imageData(file):editingCaseImage};const id=$('#caseId').value;await api(id?`/api/admin/cases/${id}`:'/api/admin/cases',{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'Кейс обновлён':'Кейс создан');resetCaseForm();await refreshAdmin();await loadCases();}catch(err){toast(err.message);}});
  function adminTab(name){$$('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===name));['items','cases','contents'].forEach(n=>$('#admin'+n[0].toUpperCase()+n.slice(1)+'Tab').classList.toggle('hidden',n!==name));if(name==='contents')loadCaseItems();}
  $$('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>adminTab(b.dataset.adminTab)));
  async function refreshAdmin(){if(!isAdmin)return;try{const [items,cases]=await Promise.all([api('/api/admin/items'),api('/api/admin/cases')]);rewardsCache=items;casesCache=cases;renderAdminItems(items);renderAdminCases(cases);fillAdminSelects(items,cases);await loadCaseItems();}catch(e){toast(e.message);}}
  function renderAdminItems(items){$('#adminItemsList').innerHTML=items.length?items.map(i=>`<article class="admin-entry"><img src="${escapeAttr(i.image_url||'')}" alt="" onerror="this.style.display='none'"><div class="admin-entry-main"><b>${escapeHtml(i.name)}</b><span>${money(i.value)} ⭐ · ${escapeHtml(i.rarity)} · ${i.active?'Активен':'Скрыт'}</span></div><div class="admin-actions"><button class="tiny-btn" data-edit-item="${i.id}">Изменить</button><button class="tiny-btn danger" data-delete-item="${i.id}">${i.active?'Скрыть':'Скрыт'}</button></div></article>`).join(''):'<div class="empty-state">Предметов пока нет. Создай первый выше.</div>';}
  function renderAdminCases(cases){$('#adminCasesList').innerHTML=cases.length?cases.map(c=>`<article class="admin-entry"><img src="${escapeAttr(c.image_url||'')}" alt="" onerror="this.style.display='none'"><div class="admin-entry-main"><b>${escapeHtml(c.name)}</b><span>${money(c.price)} ⭐ · ${c.item_count} предметов · ${c.active?'Активен':'Скрыт'}</span></div><div class="admin-actions"><button class="tiny-btn" data-edit-case="${c.id}">Изменить</button><button class="tiny-btn" data-case-contents="${c.id}">Состав</button><button class="tiny-btn danger" data-hide-case="${c.id}">Скрыть</button></div></article>`).join(''):'<div class="empty-state">Кейсов пока нет. Создай первый выше.</div>';}
  function fillAdminSelects(items,cases){const previousCase=$('#contentsCase').value,previousItem=$('#contentsItem').value;$('#contentsItem').innerHTML=items.filter(i=>i.active).map(i=>`<option value="${i.id}">${escapeHtml(i.name)} — ${money(i.value)} ⭐</option>`).join('')||'<option value="">Нет активных предметов</option>';$('#contentsCase').innerHTML=cases.filter(c=>c.active).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')||'<option value="">Нет активных кейсов</option>';if(cases.some(c=>String(c.id)===previousCase&&c.active))$('#contentsCase').value=previousCase;if(items.some(i=>String(i.id)===previousItem&&i.active))$('#contentsItem').value=previousItem;}
  document.addEventListener('click',async e=>{
    const editItem=e.target.closest('[data-edit-item]');if(editItem){try{const i=(await api('/api/admin/items')).find(x=>String(x.id)===editItem.dataset.editItem);if(!i)return;$('#itemId').value=i.id;$('#itemName').value=i.name;$('#itemDescription').value=i.description||'';$('#itemValue').value=i.value;$('#itemRarity').value=rarityNames.includes(i.rarity)?i.rarity:'обычное';$('#itemBackground').value=safeColor(i.background_color);editingItemImage=i.image_url||null;$('#itemFormTitle').textContent='Редактировать предмет';$('#itemCancelEdit').classList.remove('hidden');if(i.image_url){$('#itemImagePreview').innerHTML=`<img src="${escapeAttr(i.image_url)}" alt="">`;$('#itemImagePreview').classList.remove('hidden');}adminTab('items');window.scrollTo({top:0,behavior:'smooth'});}catch(err){toast(err.message);}return;}
    const deleteItem=e.target.closest('[data-delete-item]');if(deleteItem){if(!confirm('Скрыть предмет? Он перестанет выпадать, но останется в истории.'))return;try{await api('/api/admin/items/'+deleteItem.dataset.deleteItem,{method:'DELETE'});toast('Предмет скрыт');await refreshAdmin();await loadRewards();}catch(err){toast(err.message);}return;}
    const editCase=e.target.closest('[data-edit-case]');if(editCase){const c=(await api('/api/admin/cases')).find(x=>String(x.id)===editCase.dataset.editCase);if(!c)return;$('#caseId').value=c.id;$('#caseName').value=c.name;$('#caseDescription').value=c.description||'';$('#casePrice').value=c.price;$('#caseBackground').value=safeColor(c.background_color);editingCaseImage=c.image_url||null;$('#caseFormTitle').textContent='Редактировать кейс';$('#caseCancelEdit').classList.remove('hidden');if(c.image_url){$('#caseImagePreview').innerHTML=`<img src="${escapeAttr(c.image_url)}" alt="">`;$('#caseImagePreview').classList.remove('hidden');}adminTab('cases');window.scrollTo({top:0,behavior:'smooth'});return;}
    const contents=e.target.closest('[data-case-contents]');if(contents){$('#contentsCase').value=contents.dataset.caseContents;adminTab('contents');await loadCaseItems();window.scrollTo({top:0,behavior:'smooth'});}
    const hideCase=e.target.closest('[data-hide-case]');if(hideCase){if(!confirm('Скрыть кейс для пользователей?'))return;try{await api('/api/admin/cases/'+hideCase.dataset.hideCase,{method:'DELETE'});toast('Кейс скрыт');await refreshAdmin();await loadCases();}catch(err){toast(err.message);}return;}
    const remove=e.target.closest('[data-remove-case-item]');if(remove){try{await api(`/api/admin/cases/${$('#contentsCase').value}/items/${remove.dataset.removeCaseItem}`,{method:'DELETE'});toast('Предмет убран из кейса');await loadCaseItems();await refreshAdmin();}catch(err){toast(err.message);}}
  });
  $('#contentsCase').addEventListener('change',loadCaseItems);
  $('#addCaseItemBtn').addEventListener('click',async()=>{const caseId=$('#contentsCase').value,reward_id=Number($('#contentsItem').value),visual_chance=Number($('#visualChance').value),real_chance=Number($('#realChance').value);if(!caseId||!reward_id){toast('Сначала создай кейс и предмет');return;}try{await api(`/api/admin/cases/${caseId}/items`,{method:'POST',body:JSON.stringify({reward_id,visual_chance,real_chance})});toast('Содержимое кейса сохранено');await loadCaseItems();await refreshAdmin();}catch(e){toast(e.message);}});
  async function loadCaseItems(){const id=$('#contentsCase').value;if(!id){$('#caseItemsList').innerHTML='<div class="empty-state">Создай кейс и добавь предметы.</div>';$('#caseChanceSum').textContent='';return;}try{const items=await api(`/api/admin/cases/${id}/items`);const sum=items.reduce((a,x)=>a+Number(x.real_chance),0);$('#caseChanceSum').textContent=`Сумма реальных шансов: ${sum.toFixed(2)}% ${Math.abs(sum-100)<.01?'— готово к открытию':'— для открытия нужно ровно 100%'}`;$('#caseItemsList').innerHTML=items.length?items.map(i=>`<article class="admin-entry"><img src="${escapeAttr(i.image_url||'')}" alt="" onerror="this.style.display='none'"><div class="admin-entry-main"><b>${escapeHtml(i.name)}</b><span>Визуальный: ${money(i.visual_chance)}% · Реальный: ${money(i.real_chance)}%</span></div><button class="tiny-btn danger" data-remove-case-item="${i.id}">Убрать</button></article>`).join(''):'<div class="empty-state">В этом кейсе пока нет предметов.</div>';}catch(e){$('#caseItemsList').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;}}
  async function checkAdmin(){try{const data=await api('/api/admin/status');isAdmin=!!data.isAdmin;$('#adminOpenBtn').classList.toggle('hidden',!isAdmin);}catch{isAdmin=false;}}
  async function boot(){await checkAdmin();await Promise.all([loadMe(),loadRewards(),loadCases()]);if(isAdmin)await refreshAdmin();icons();}
  boot();
})();
