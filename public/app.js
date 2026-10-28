(() => {
  const tg = window.Telegram?.WebApp;
  tg?.ready(); tg?.expand();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const rarityNames = ['обычное','необычное','редкое','сверхредкое','легендарное','мифическое','???'];
  function rarityClass(value){const v=String(value||'обычное').trim().toLowerCase();if(v==='мифическое'||v==='мифический')return 'rarity-mythic';if(v==='легендарное'||v==='легендарный')return 'rarity-legendary';if(v==='сверхредкое'||v==='ультра-редкий'||v==='ультра редкий'||v==='редкое')return 'rarity-ultra';if(v==='необычное'||v==='необычный')return 'rarity-uncommon';if(v==='???')return 'rarity-unknown';return 'rarity-common';}
  function rarityLabel(value){const v=String(value||'обычное').trim().toLowerCase();if(v==='мифическое')return 'мифический';if(v==='легендарное')return 'легендарный';if(v==='сверхредкое'||v==='редкое')return 'ультра-редкий';if(v==='необычное')return 'необычный';if(v==='обычное')return 'обычный';return v;}
  let selectedAmount = 100, me = null, isAdmin = false, rewardsCache = [], casesCache = [], upgradeStakeCache = [], editingItemImage = null, editingCaseImage = null, upgradePickerMode = null;
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
    const pages=['home','cases','caseDetail','games','double','upgrader','topup','inventory','profile','settings','admin'];
    pages.forEach(p=>$('#'+p+'Page')?.classList.toggle('hidden',p!==page));
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    if(page==='inventory'||page==='upgrader') loadMe();
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
  const spark = '<span class="spark-icon">✦</span>';
  function sparks(v){return `${money(v)} Искр`;}
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
    const available=items.filter(r=>['Из кейса','owned','Выдан администратором'].includes(r.status));
    $('#inventory').innerHTML=items.length?items.map(r=>{const canUse=['Из кейса','owned','Выдан администратором'].includes(r.status);return `<article class="reward-item inventory-row">${canUse?`<input class="withdraw-check" type="checkbox" value="${r.id}" data-value="${Number(r.reward_value)}" aria-label="Выбрать ${escapeAttr(r.reward_name)}">`:''}${r.reward_image?`<img class="reward-image" src="${escapeAttr(r.reward_image)}" alt="">`:`<div class="reward-placeholder"><i data-lucide="package-check"></i></div>`}<div class="reward-info"><b>${escapeHtml(r.reward_name)}</b><span>${escapeHtml(r.status||'В коллекции')} · <i class="rarity-text ${rarityClass(r.reward_rarity)}">${escapeHtml(rarityLabel(r.reward_rarity))}</i></span><span class="price">${money(r.reward_value)} ${spark}</span></div></article>`}).join(''):'<div class="empty-state">Здесь появятся предметы, которые ты получишь из кейсов или игр.</div>';
    $('#inventoryControls').classList.toggle('hidden',!available.length); updateInventorySelection(); renderUpgradeStakeItems(available); icons();
  }
  function updateInventorySelection(){const checks=$$('.withdraw-check:checked');const total=checks.reduce((a,c)=>a+Number(c.dataset.value||0),0);$('#withdrawTotal').textContent=sparks(total);$('#withdrawBtn').disabled=!checks.length||total<50;$('#withdrawBtn').textContent=total<50?'Вывести (от 50 Искр)':'Вывести';$('#sellSelectedBtn').disabled=!checks.length;$('#inventorySelectionHint').textContent=checks.length?`Выбрано ${checks.length} предмет(ов)`:'Выбери один или несколько предметов';}
  function renderUpgradeStakeItems(items){upgradeStakeCache=items||[];const el=$('#upgradeStakeItems');if(!el)return;el.innerHTML=items.length?items.map(r=>`<label class="select-item"><input type="radio" name="upgradeStakeItem" value="${r.id}" data-value="${Number(r.reward_value)}" data-name="${escapeAttr(r.reward_name)}" data-image="${escapeAttr(r.reward_image||'')}"><span>${r.reward_image?`<img src="${escapeAttr(r.reward_image)}" alt="">`:'<span class="reward-placeholder">✦</span>'}<b>${escapeHtml(r.reward_name)}</b><small>${money(r.reward_value)} Искр</small></span></label>`).join(''):'<div class="empty-state">Нет предметов для ставки. Получи предмет из кейса.</div>'; updateUpgradePreview();}
  function renderUpgradeTargets(){const el=$('#upgradeTargetItems');if(!el)return;el.innerHTML=rewardsCache.length?rewardsCache.map(r=>`<label class="select-item"><input type="radio" name="upgradeTargetItem" value="${r.id}" data-value="${Number(r.value)}" data-name="${escapeAttr(r.name)}" data-image="${escapeAttr(r.image_url||'')}"><span>${r.image_url?`<img src="${escapeAttr(r.image_url)}" alt="">`:'<span class="reward-placeholder">✦</span>'}<b>${escapeHtml(r.name)}</b><small>${money(r.value)} Искр</small></span></label>`).join(''):'<div class="empty-state">Нет предметов для цели.</div>';}
  function openUpgradePicker(mode){upgradePickerMode=mode;const modal=$('#upgradePickerModal'),title=$('#upgradePickerTitle'),list=$('#upgradePickerList');if(!modal||!list)return;const stake=selectedStake();title.textContent=mode==='stake'?'Выбери предмет для ставки':'Выбери целевой предмет';let items=mode==='stake'?upgradeStakeCache:rewardsCache;if(mode==='target'&&stake)items=items.filter(r=>Number(r.value)>stake.value);list.innerHTML=items.length?items.map(r=>{const id=mode==='stake'?r.id:r.id,val=mode==='stake'?r.reward_value:r.value,img=mode==='stake'?r.reward_image:r.image_url,name=mode==='stake'?r.reward_name:r.name;return `<button type="button" class="picker-item" data-picker-id="${id}" data-picker-mode="${mode}">${img?`<img src="${escapeAttr(img)}" alt="">`:'<span class="reward-placeholder">✦</span>'}<b>${escapeHtml(name)}</b><small>${money(val)} Искр</small></button>`}).join(''):`<div class="empty-state">${mode==='target'&&stake?'Нет целевых предметов дороже ставки.':'Нет доступных предметов.'}</div>`;modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');}
  function closeUpgradePicker(){const modal=$('#upgradePickerModal');if(modal){modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');}}
  function selectedStake(){const input=$('input[name="upgradeStakeItem"]:checked');return input?{id:Number(input.value),value:Number(input.dataset.value||0),name:input.dataset.name||'Предмет',image:input.dataset.image||''}:null;}
  function selectedTarget(){const input=$('input[name="upgradeTargetItem"]:checked');return input?{id:Number(input.value),value:Number(input.dataset.value||0),name:input.dataset.name||'Предмет',image_url:input.dataset.image||''}:null;}
  function setTarget(id){const input=$(`input[name="upgradeTargetItem"][value="${Number(id)}"]`);if(input)input.checked=true;$('#upgradeReward').value=String(id);updateUpgradePreview();}
  function targetChance(stake,target){return stake&&target&&Number(target.value)>0?Math.min(75,stake.value/Number(target.value)*100):0;}
  function updateUpgradePreview(){const stake=selectedStake();let target=selectedTarget();if(stake&&target&&Number(target.value)<=Number(stake.value)){const invalid=$(`input[name="upgradeTargetItem"][value="${Number(target.id)}"]`);if(invalid)invalid.checked=false;$('#upgradeReward').value='';target=null;}$('#upgradeStakePreview').textContent=stake?.name||'Кликни, чтобы выбрать ставочный предмет';$('#upgradeStakeValue').textContent=stake?sparks(stake.value):'— Искр';$('#upgradeTargetPreview').textContent=target?.name||'Кликни, чтобы выбрать целевой предмет';$('#upgradeTargetValue').textContent=target?sparks(target.value):'— Искр';const si=$('#upgradeStakeImage'),sf=$('#upgradeStakeFallback'),ti=$('#upgradeTargetImage'),tf=$('#upgradeTargetFallback');si.src=stake?.image||'';si.classList.toggle('hidden',!stake?.image);sf.classList.toggle('hidden',!!stake?.image);ti.src=target?.image_url||'';ti.classList.toggle('hidden',!target?.image_url);tf.classList.toggle('hidden',!!target?.image_url);const chance=targetChance(stake,target);$('#upgradeChance').textContent=stake&&target?`${chance.toFixed(1)}%`:'—%';$('#chanceRing').style.setProperty('--chance',`${chance*3.6}deg`);$$('[data-chance]').forEach(b=>b.classList.toggle('selected',Math.abs(chance-Number(b.dataset.chance))<3));$$('input[name="upgradeTargetItem"]').forEach(i=>i.closest('.select-item')?.classList.toggle('target-unavailable',!!stake&&Number(i.dataset.value)<=stake.value));}
  function chooseClosestTarget(desiredChance){const stake=selectedStake();if(!stake||!rewardsCache.length){toast('Сначала выбери предмет для ставки');return;}const options=rewardsCache.filter(r=>Number(r.value)>stake.value);if(!options.length){toast('Нет целевого предмета дороже ставки');return;}options.sort((a,b)=>Math.abs(targetChance(stake,a)-desiredChance)-Math.abs(targetChance(stake,b)-desiredChance));setTarget(options[0].id);}
  function chooseMultiplier(multiplier){const stake=selectedStake();if(!stake){toast('Сначала выбери предмет для ставки');return;}const desired=stake.value*multiplier;const options=rewardsCache.filter(r=>Number(r.value)>stake.value);if(!options.length){toast('Нет целевого предмета дороже ставки');return;}options.sort((a,b)=>Math.abs(Number(a.value)-desired)-Math.abs(Number(b.value)-desired));setTarget(options[0].id);}

  function renderWithdrawals(rows){const el=$('#withdrawHistory');if(!el)return;el.innerHTML=rows.length?rows.map(w=>{const cls=w.status==='closed'?'status-closed':w.status==='cancelled'?'status-cancelled':'status-pending';const label=w.status==='closed'?'Закрыто':w.status==='cancelled'?'Отменено':'В ожидании';const items=Array.isArray(w.item_snapshot)?w.item_snapshot.map(i=>i.reward_name).join(', '):'';return `<article class="withdraw-entry"><div><b>Заявка #${w.id}</b><span>${escapeHtml(items||'Предметы')} · ${sparks(w.total_value)}</span></div><strong class="${cls}">${label}</strong></article>`}).join(''):'<div class="empty-state">Заявок пока нет.</div>';}
  function renderProfile(){
    renderAvatar(); const user=me?.user||{}, stats=me?.stats||{};
    $('#statBalance').textContent=sparks(me?.balance); $('#statItems').textContent=stats.items_owned??(me?.inventory?.length||0);
    $('#statCases').textContent=stats.cases_opened??0; $('#statGames').textContent=stats.games_played??0;
    $('#joinedDate').textContent='В игре с '+(user.created_at?new Date(user.created_at).toLocaleDateString('ru-RU'):'первого входа');
    $('#bestPrizeName').textContent=stats.best_prize_name||'Пока нет призов';
    $('#bestPrizeValue').textContent=stats.best_prize_name?sparks(stats.best_prize_value):'Открой первый кейс';
    const best=(me?.inventory||[]).slice().sort((a,b)=>Number(b.reward_value)-Number(a.reward_value))[0];
    $('#bestPrizeImage').innerHTML=best?.reward_image?`<img class="reward-image" src="${escapeAttr(best.reward_image)}" alt="">`:'<i data-lucide="gift"></i>';
    $('#adminOpenBtn').classList.toggle('hidden',!isAdmin); icons();
  }
  async function loadMe(){
    try{me=await api('/api/me');$('#balance').textContent=money(me.balance??me.user?.balance??0);renderInventory(me.inventory||[]);renderWithdrawals(me.withdrawals||[]);renderProfile();}
    catch(e){$('#balance').textContent='—';if(!tg?.initData) toast('Открой Mini App из Telegram-бота.');}
  }
  function safeColor(color){return /^#[0-9a-f]{6}$/i.test(color||'')?color:'#123c2b';}
  function rewardCard(r){return `<article class="reward-item">${r.image_url?`<img class="reward-image" src="${escapeAttr(r.image_url)}" alt="">`:`<div class="reward-placeholder"><i data-lucide="gift"></i></div>`}<div class="reward-info"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.description||'Предмет коллекции')}</span><span class="rarity-text ${rarityClass(r.rarity)}">${escapeHtml(rarityLabel(r.rarity))}</span></div><span class="price">${money(r.value)} Искр</span></article>`;}
  async function loadRewards(){
    try{rewardsCache=await api('/api/rewards');$('#rewardCount').textContent=rewardsCache.length;$('#rewards').innerHTML=rewardsCache.length?rewardsCache.map(rewardCard).join(''):'<div class="empty-state">Пока нет предметов. Загляни позже.</div>';
      $('#upgradeReward').innerHTML=rewardsCache.map(r=>`<option value="${r.id}">${escapeHtml(r.name)} — ${money(r.value)} Искр</option>`).join('')||'<option value="">Нет предметов</option>';renderUpgradeTargets();if(rewardsCache.length)setTarget(rewardsCache[0].id);else updateUpgradePreview();icons();
    }catch(e){$('#rewards').innerHTML='<p class="muted">Не удалось загрузить предметы.</p>';}
  }
  function caseCard(c){return `<article class="case-card" data-case-id="${c.id}"><div class="case-art">${c.image_url?`<img src="${escapeAttr(c.image_url)}" alt="">`:'<i class="case-glyph" data-lucide="package-open"></i>'}</div><div class="case-meta"><b>${escapeHtml(c.name)}</b><p>${escapeHtml(c.description||`${c.item_count||0} предметов внутри`)}</p><div class="case-bottom"><span class="case-price">${money(c.price)} Искр</span><button class="mini-btn" data-open-case="${c.id}">Открыть</button></div></div></article>`;}
  let audioCtx=null; function audio(){if(!audioCtx)audioCtx=new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();return audioCtx;}
  function playTone(freq,duration,type='sine',volume=.035,delay=0){try{const ctx=audio(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,ctx.currentTime+delay);gain.gain.setValueAtTime(volume,ctx.currentTime+delay);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+delay+duration);osc.connect(gain);gain.connect(ctx.destination);osc.start(ctx.currentTime+delay);osc.stop(ctx.currentTime+delay+duration);}catch{}}
  function playSwipe(){playTone(950,.045,'triangle',.018);}
  function rouletteProgress(x){let lo=0,hi=1,t=.5;for(let i=0;i<16;i++){t=(lo+hi)/2;const bx=3*(1-t)*(1-t)*t*.08+3*(1-t)*t*t*.08+t*t*t;if(bx<x)lo=t;else hi=t;}return 3*(1-t)*(1-t)*t*.72+3*(1-t)*t*t+t*t*t;}
  function playWin(){playTone(440,.14,'sine',.05);playTone(660,.18,'sine',.045,.1);playTone(880,.3,'triangle',.04,.23);}
  function playFirework(){try{const ctx=audio(),len=Math.floor(ctx.sampleRate*.75),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();filter.type='lowpass';filter.frequency.value=1800;gain.gain.setValueAtTime(.18,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.75);src.buffer=buf;src.connect(filter);filter.connect(gain);gain.connect(ctx.destination);src.start();playTone(110,.22,'sine',.06);playTone(760,.22,'triangle',.025,.06);}catch{}}
  function confetti(host){const layer=document.createElement('div');layer.className='confetti-layer';for(let i=0;i<70;i++){const bit=document.createElement('i');bit.style.left=(Math.random()*100)+'%';bit.style.setProperty('--fall', (2+Math.random()*2)+'s');bit.style.setProperty('--drift', ((Math.random()-.5)*180)+'px');bit.style.setProperty('--delay',(Math.random()*.45)+'s');bit.style.setProperty('--hue',Math.floor(Math.random()*360));layer.appendChild(bit);}host.appendChild(layer);setTimeout(()=>layer.remove(),4500);}
  function playRoulette(items,reward){return new Promise(resolve=>{const host=$('#caseOpenResult');host.classList.remove('hidden');host.scrollIntoView({behavior:'smooth',block:'start'});host.innerHTML=`<div class="roulette-wrap"><div class="roulette-pointer">▼</div><div class="roulette-track" id="rouletteTrack"></div></div><p class="roulette-caption">Определяем приз…</p>`;const track=$('#rouletteTrack');const sequence=[];const finalIndex=34;for(let i=0;i<finalIndex;i++)sequence.push(items[Math.floor(Math.random()*items.length)]);sequence.push(items.find(x=>String(x.id)===String(reward.id))||reward);track.innerHTML=sequence.map((r,i)=>`<div class="roulette-item ${rarityClass(r.rarity)}" data-index="${i}">${r.image_url?`<img src="${escapeAttr(r.image_url)}" alt="">`:'<div class="reward-placeholder">✦</div>'}<b>${escapeHtml(r.name)}</b><small>${money(r.value)} Искр</small></div>`).join('');const first=track.querySelector('.roulette-item');const style=getComputedStyle(track);const gap=parseFloat(style.gap)||8;const itemWidth=first?.getBoundingClientRect().width||104;const viewport=host.querySelector('.roulette-wrap');const target=finalIndex*(itemWidth+gap)+itemWidth/2-(viewport?.clientWidth||host.clientWidth)/2;track.style.transition='none';track.style.transform='translateX(0)';const duration=6800;let lastTick=-1,startTime=0;const animateSound=t=>{if(!startTime)startTime=t;const p=Math.min(1,(t-startTime)/duration);const eased=rouletteProgress(p);const current=eased*finalIndex;const idx=Math.floor(current);if(idx!==lastTick){playSwipe();lastTick=idx;}if(p<1)requestAnimationFrame(animateSound);};requestAnimationFrame(()=>{requestAnimationFrame(()=>{track.style.transition=`transform ${duration}ms cubic-bezier(.08,.72,.08,1)`;track.style.transform=`translateX(-${Math.max(0,target)}px)`;requestAnimationFrame(animateSound);setTimeout(()=>{playWin();playFirework();host.innerHTML=`<div class="prize-reveal"><div class="prize-swipe"></div>${reward.image_url?`<img src="${escapeAttr(reward.image_url)}" alt="">`:'<div class="reward-placeholder">✦</div>'}<span class="rarity-text ${rarityClass(reward.rarity)}">${escapeHtml(rarityLabel(reward.rarity))}</span><h3>${escapeHtml(reward.name)}</h3><div class="prize-value">${money(reward.value)} Искр</div><p>Шанс: ${money((items.find(x=>String(x.id)===String(reward.id))||{}).visual_chance||0)}%</p><button class="primary-btn" id="prizeDone">Отлично!</button></div>`;confetti(host);$('#prizeDone').addEventListener('click',()=>{playSwipe();host.classList.add('hidden');resolve();});},duration+150);});});});}
  async function loadCases(){
    try{casesCache=await api('/api/cases');const html=casesCache.length?casesCache.map(caseCard).join(''):'<div class="empty-state">Кейсов пока нет.</div>';$('#casesList').innerHTML=html;$('#homeCases').innerHTML=casesCache.slice(0,4).map(caseCard).join('')||'<div class="empty-state">Кейсы скоро появятся.</div>';icons();
    }catch(e){$('#casesList').innerHTML='<div class="empty-state">Не удалось загрузить кейсы.</div>';$('#homeCases').innerHTML='';}
  }
  async function showCase(id){
    showPage('caseDetail'); $('#caseDetail').innerHTML='<div class="loading">Загружаем кейс…</div>';
    try{const data=await api('/api/cases/'+id);const c=data.case;
      $('#caseDetail').innerHTML=`<div id="caseOpenResult" class="result-box hidden case-roulette-top"></div><button class="primary-btn case-open-top" id="openCaseNow" ${data.items.length?'':'disabled'}>Открыть за ${money(c.price)} Искр <i data-lucide="sparkles"></i></button><div class="detail-hero">${c.image_url?`<img src="${escapeAttr(c.image_url)}" alt="">`:'<i class="case-glyph" data-lucide="package-open"></i>'}<h2>${escapeHtml(c.name)}</h2><p class="muted">${escapeHtml(c.description||'Содержимое кейса')}</p><b>${money(c.price)} Искр</b></div><h3 class="subheading">Содержимое кейса</h3><div class="detail-items">${data.items.map(r=>`<article class="detail-item">${r.image_url?`<img src="${escapeAttr(r.image_url)}" alt="">`:'<div class="reward-placeholder"><i data-lucide="gift"></i></div>'}<b>${escapeHtml(r.name)}</b><span class="rarity-text ${rarityClass(r.rarity)}">${escapeHtml(rarityLabel(r.rarity))}</span><span>${money(r.value)} Искр</span><span class="chance-badge">Шанс: ${money(r.visual_chance)}%</span></article>`).join('')||'<div class="empty-state">В кейсе ещё нет предметов.</div>'}</div>`;
      $('#openCaseNow')?.addEventListener('click',async()=>{const btn=$('#openCaseNow');btn.disabled=true;try{const result=await api(`/api/cases/${id}/open`,{method:'POST',body:'{}'});await playRoulette(data.items,result.reward);toast('Кейс открыт!');await window.__appLoadMe?.();}catch(e){toast(e.message);}finally{btn.disabled=false;}});icons();
    }catch(e){$('#caseDetail').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;}
  }
  document.addEventListener('click',e=>{const btn=e.target.closest('[data-open-case]');const card=e.target.closest('[data-case-id]');const id=btn?.dataset.openCase||card?.dataset.caseId;if(id)showCase(id);});

  $$('.pack').forEach(b=>b.addEventListener('click',()=>{$$('.pack').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');selectedAmount=Number(b.dataset.amount);$('#customAmount').value='';updateTopupButton();}));
  $('#customAmount').addEventListener('input',()=>{$$('.pack').forEach(x=>x.classList.remove('selected'));selectedAmount=Number($('#customAmount').value)||0;updateTopupButton();});
  function updateTopupButton(){const amount=Number($('#customAmount').value)||selectedAmount;$('#topupBtn').innerHTML=`Пополнить на ${amount>0?amount:0} Искр <i data-lucide="arrow-right"></i>`;icons();}
  $('#topupBtn').addEventListener('click',async()=>{const amount=Number($('#customAmount').value)||selectedAmount;if(!Number.isInteger(amount)||amount<1||amount>10000){toast('Укажи сумму от 1 до 10 000 Искр');return;}if(!tg?.initData){toast('Открой приложение через Telegram-бота для оплаты.');return;}const btn=$('#topupBtn');btn.disabled=true;try{const result=await api('/api/topup',{method:'POST',body:JSON.stringify({amount})});if(!result.invoiceLink)throw new Error('Сервер не вернул ссылку оплаты');tg.openInvoice(result.invoiceLink,status=>{if(status==='paid'){toast('Оплата прошла! Искры зачисляются по курсу 1:1.');setTimeout(loadMe,900);}else if(status==='cancelled')toast('Оплата отменена.');else if(status==='failed')toast('Не удалось провести оплату.');});}catch(e){toast(e.message==='Failed to fetch'?'Не удалось связаться с сервером.':e.message);}finally{btn.disabled=false;}});
  $('#inventory').addEventListener('change',e=>{if(e.target.matches('.withdraw-check'))updateInventorySelection();});
  $('#sellSelectedBtn').addEventListener('click',async()=>{const inventoryIds=$$('.withdraw-check:checked').map(c=>Number(c.value));if(!inventoryIds.length)return;if(!confirm(`Продать ${inventoryIds.length} выбранных предмет(ов) и получить их стоимость в Искрах?`))return;const btn=$('#sellSelectedBtn');btn.disabled=true;try{const r=await api('/api/inventory/sell-selected',{method:'POST',body:JSON.stringify({inventoryIds})});toast(`Продано предметов: ${r.count}. Начислено ${money(r.total)} Искр`);await window.__appLoadMe?.();}catch(err){toast(err.message);}finally{btn.disabled=false;}});
  $('#withdrawBtn').addEventListener('click',async()=>{const inventoryIds=$$('.withdraw-check:checked').map(c=>Number(c.value));if(!inventoryIds.length)return;const total=$$('.withdraw-check:checked').reduce((a,c)=>a+Number(c.dataset.value||0),0);if(total<50){toast('Минимальная сумма вывода — 50 Искр');return;}const btn=$('#withdrawBtn');btn.disabled=true;try{await api('/api/withdrawals',{method:'POST',body:JSON.stringify({inventoryIds})});toast('Заявка на вывод отправлена администраторам');await window.__appLoadMe?.();}catch(err){toast(err.message);}finally{btn.disabled=false;}});
  $('#upgradeStakeSlot').addEventListener('click',()=>openUpgradePicker('stake'));
  $('#upgradeTargetSlot').addEventListener('click',()=>openUpgradePicker('target'));
  $('#upgradePickerClose').addEventListener('click',closeUpgradePicker);
  $('#upgradePickerModal').addEventListener('click',e=>{if(e.target===$('#upgradePickerModal'))closeUpgradePicker();const item=e.target.closest('[data-picker-id]');if(!item)return;const id=Number(item.dataset.pickerId);if(item.dataset.pickerMode==='stake'){const input=$(`input[name="upgradeStakeItem"][value="${id}"]`);if(input){input.checked=true;updateUpgradePreview();}}else{setTarget(id);}closeUpgradePicker();});
  $('#upgradeStakeItems').addEventListener('change',e=>{if(e.target.matches('input[name="upgradeStakeItem"]'))updateUpgradePreview();});
  $('#upgradeReward').addEventListener('change',e=>setTarget(e.target.value));
  $('#upgradeTargetItems').addEventListener('change',e=>{if(e.target.matches('input[name="upgradeTargetItem"]')){ $('#upgradeReward').value=e.target.value;updateUpgradePreview(); }});
  $$('[data-chance]').forEach(b=>b.addEventListener('click',()=>chooseClosestTarget(Number(b.dataset.chance))));
  $$('[data-multiplier]').forEach(b=>b.addEventListener('click',()=>chooseMultiplier(Number(b.dataset.multiplier))));
  $('#upgradeBtn').addEventListener('click',async()=>{const target=selectedTarget(),stake=selectedStake(),rewardId=Number(target?.id),inventoryId=Number(stake?.id);if(!rewardId||!inventoryId){toast('Кликни на оба слота и выбери предметы');return;}if(Number(target.value)<=Number(stake.value)){toast('Целевой предмет должен быть дороже ставки');return;}const btn=$('#upgradeBtn');btn.disabled=true;$('#upgradeResult').classList.add('hidden');try{const r=await api('/api/upgrade',{method:'POST',body:JSON.stringify({rewardId,inventoryId})});const pointer=$('#upgradeSpinPointer'),ring=$('#chanceRing');const chance=Number(r.chance??targetChance(stake,target));const endAngle=r.won?Math.random()*Math.max(.2,chance*3.6):chance*3.6+Math.random()*Math.max(.2,360-chance*3.6);pointer.classList.remove('spinning');pointer.style.setProperty('--spin-end','0deg');void pointer.offsetWidth;pointer.style.setProperty('--spin-end',`${360*7+endAngle}deg`);pointer.classList.add('spinning');await new Promise(resolve=>setTimeout(resolve,3900));pointer.classList.remove('spinning');pointer.style.transform=`rotate(${endAngle}deg)`;if(r.won){playWin();playFirework();confetti(ring);}else playTone(170,.3,'sawtooth',.04);$('#upgradeResult').classList.remove('hidden');$('#upgradeResult').innerHTML=`<div style="text-align:center"><b>${r.won?'Успех! Ты получил предмет 🎉':'В этот раз не повезло'}</b><p>${escapeHtml(r.reward.name)} · Ценность: ${money(r.reward.value)} Искр</p></div>`;await window.__appLoadMe?.();}catch(e){toast(e.message);}finally{btn.disabled=false;}});

  async function imageData(file){
    if(!file)return null;if(!file.type.startsWith('image/'))throw new Error('Выбери файл изображения');
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Не удалось прочитать картинку'));reader.onload=()=>{const img=new Image();img.onerror=()=>reject(new Error('Файл не является корректным изображением'));img.onload=()=>{const max=1000,scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.82);if(data.length>1400000)return reject(new Error('Картинка слишком большая, выбери файл поменьше'));resolve(data);};img.src=reader.result;};reader.readAsDataURL(file);});
  }
  function previewFile(input,preview){input.addEventListener('change',async()=>{const file=input.files?.[0];if(!file){preview.classList.add('hidden');return;}try{const data=await imageData(file);preview.innerHTML=`<img src="${data}" alt="Предпросмотр">`;preview.classList.remove('hidden');}catch(e){toast(e.message);input.value='';}});}
  previewFile($('#itemImage'),$('#itemImagePreview'));previewFile($('#caseImage'),$('#caseImagePreview'));
  function resetItemForm(){editingItemImage=null;$('#itemForm').reset();$('#itemId').value='';$('#itemFormTitle').textContent='Создать предмет';$('#itemCancelEdit').classList.add('hidden');$('#itemImagePreview').classList.add('hidden');$('#itemImagePreview').innerHTML='';$('#itemRarity').value='обычное';}
  function resetCaseForm(){editingCaseImage=null;$('#caseForm').reset();$('#caseId').value='';$('#caseFormTitle').textContent='Создать кейс';$('#caseCancelEdit').classList.add('hidden');$('#caseImagePreview').classList.add('hidden');$('#caseImagePreview').innerHTML='';}
  $('#itemCancelEdit').addEventListener('click',resetItemForm);$('#caseCancelEdit').addEventListener('click',resetCaseForm);
  $('#itemForm').addEventListener('submit',async e=>{e.preventDefault();try{const file=$('#itemImage').files?.[0];const payload={name:$('#itemName').value.trim(),description:$('#itemDescription').value.trim(),value:Number($('#itemValue').value),rarity:$('#itemRarity').value,image_url:file?await imageData(file):editingItemImage};const id=$('#itemId').value;await api(id?`/api/admin/items/${id}`:'/api/admin/items',{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'Предмет обновлён':'Предмет создан');resetItemForm();await refreshAdmin();await loadRewards();}catch(err){toast(err.message);}});
  $('#caseForm').addEventListener('submit',async e=>{e.preventDefault();try{const file=$('#caseImage').files?.[0];const payload={name:$('#caseName').value.trim(),description:$('#caseDescription').value.trim(),price:Number($('#casePrice').value),image_url:file?await imageData(file):editingCaseImage};const id=$('#caseId').value;await api(id?`/api/admin/cases/${id}`:'/api/admin/cases',{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'Кейс обновлён':'Кейс создан');resetCaseForm();await refreshAdmin();await loadCases();}catch(err){toast(err.message);}});
  async function loadFreeCaseAdmin(){try{const data=await api('/api/admin/free-case');$('#freeCaseRewardOptions').innerHTML=data.rewards.map(r=>`<label class="admin-entry"><input type="checkbox" class="free-case-reward-check" value="${r.id}" ${data.ids.includes(Number(r.id))?'checked':''} ${!r.active?'disabled':''}><div class="admin-entry-main"><b>${escapeHtml(r.name)}</b><span>${money(r.value)} Искр · ${escapeHtml(r.rarity||'обычное')} · ${r.active?'Активен':'Скрыт'}</span></div></label>`).join('')||'<div class="empty-state">Создай предметы во вкладке «Предметы».</div>';$('#freeCaseAdminStatus').textContent=data.ids.length?`Выбрано предметов: ${data.ids.length}`:'Не выбрано: будут использоваться все активные предметы.';}catch(e){$('#freeCaseAdminStatus').textContent=e.message;}}
  $('#saveFreeCaseContents')?.addEventListener('click',async()=>{const ids=$$('.free-case-reward-check:checked').map(x=>Number(x.value));try{await api('/api/admin/free-case',{method:'PUT',body:JSON.stringify({ids})});$('#freeCaseAdminStatus').textContent=ids.length?`Сохранено. Выбрано предметов: ${ids.length}`:'Сохранено. Будут использоваться все активные предметы.';toast('Содержимое бесплатного кейса сохранено');}catch(e){$('#freeCaseAdminStatus').textContent=e.message;}});
  function adminTab(name){$$('[data-admin-tab]').forEach(b=>b.classList.toggle('active',b.dataset.adminTab===name));['items','cases','contents','freecase'].forEach(n=>$('#admin'+n[0].toUpperCase()+n.slice(1)+'Tab').classList.toggle('hidden',n!==name));if(name==='contents')loadCaseItems();if(name==='freecase')loadFreeCaseAdmin();}
  $$('[data-admin-tab]').forEach(b=>b.addEventListener('click',()=>adminTab(b.dataset.adminTab)));
  async function refreshAdmin(){if(!isAdmin)return;try{const [items,cases]=await Promise.all([api('/api/admin/items'),api('/api/admin/cases')]);rewardsCache=items;casesCache=cases;renderAdminItems(items);renderAdminCases(cases);fillAdminSelects(items,cases);await loadCaseItems();}catch(e){toast(e.message);}}
  function renderAdminItems(items){$('#adminItemsList').innerHTML=items.length?items.map(i=>`<article class="admin-entry"><img src="${escapeAttr(i.image_url||'')}" alt="" onerror="this.style.display='none'"><div class="admin-entry-main"><b>${escapeHtml(i.name)}</b><span>${money(i.value)} Искр · ${escapeHtml(i.rarity)} · ${i.active?'Активен':'Скрыт'}</span></div><div class="admin-actions"><button class="tiny-btn" data-edit-item="${i.id}">Изменить</button><button class="tiny-btn danger" data-delete-item="${i.id}">${i.active?'Скрыть':'Скрыт'}</button></div></article>`).join(''):'<div class="empty-state">Предметов пока нет. Создай первый выше.</div>';}
  function renderAdminCases(cases){$('#adminCasesList').innerHTML=cases.length?cases.map(c=>`<article class="admin-entry"><img src="${escapeAttr(c.image_url||'')}" alt="" onerror="this.style.display='none'"><div class="admin-entry-main"><b>${escapeHtml(c.name)}</b><span>${money(c.price)} Искр · ${c.item_count} предметов · ${c.active?'Активен':'Скрыт'}</span></div><div class="admin-actions"><button class="tiny-btn" data-edit-case="${c.id}">Изменить</button><button class="tiny-btn" data-case-contents="${c.id}">Состав</button><button class="tiny-btn danger" data-hide-case="${c.id}">Скрыть</button></div></article>`).join(''):'<div class="empty-state">Кейсов пока нет. Создай первый выше.</div>';}
  function fillAdminSelects(items,cases){const previousCase=$('#contentsCase').value,previousItem=$('#contentsItem').value;$('#contentsItem').innerHTML=items.filter(i=>i.active).map(i=>`<option value="${i.id}">${escapeHtml(i.name)} — ${money(i.value)} Искр</option>`).join('')||'<option value="">Нет активных предметов</option>';$('#contentsCase').innerHTML=cases.filter(c=>c.active).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')||'<option value="">Нет активных кейсов</option>';if(cases.some(c=>String(c.id)===previousCase&&c.active))$('#contentsCase').value=previousCase;if(items.some(i=>String(i.id)===previousItem&&i.active))$('#contentsItem').value=previousItem;}
  document.addEventListener('click',async e=>{
    const editItem=e.target.closest('[data-edit-item]');if(editItem){try{const i=(await api('/api/admin/items')).find(x=>String(x.id)===editItem.dataset.editItem);if(!i)return;$('#itemId').value=i.id;$('#itemName').value=i.name;$('#itemDescription').value=i.description||'';$('#itemValue').value=i.value;$('#itemRarity').value=rarityNames.includes(i.rarity)?i.rarity:'обычное';editingItemImage=i.image_url||null;$('#itemFormTitle').textContent='Редактировать предмет';$('#itemCancelEdit').classList.remove('hidden');if(i.image_url){$('#itemImagePreview').innerHTML=`<img src="${escapeAttr(i.image_url)}" alt="">`;$('#itemImagePreview').classList.remove('hidden');}adminTab('items');window.scrollTo({top:0,behavior:'smooth'});}catch(err){toast(err.message);}return;}
    const deleteItem=e.target.closest('[data-delete-item]');if(deleteItem){if(!confirm('Скрыть предмет? Он перестанет выпадать, но останется в истории.'))return;try{await api('/api/admin/items/'+deleteItem.dataset.deleteItem,{method:'DELETE'});toast('Предмет скрыт');await refreshAdmin();await loadRewards();}catch(err){toast(err.message);}return;}
    const editCase=e.target.closest('[data-edit-case]');if(editCase){const c=(await api('/api/admin/cases')).find(x=>String(x.id)===editCase.dataset.editCase);if(!c)return;$('#caseId').value=c.id;$('#caseName').value=c.name;$('#caseDescription').value=c.description||'';$('#casePrice').value=c.price;editingCaseImage=c.image_url||null;$('#caseFormTitle').textContent='Редактировать кейс';$('#caseCancelEdit').classList.remove('hidden');if(c.image_url){$('#caseImagePreview').innerHTML=`<img src="${escapeAttr(c.image_url)}" alt="">`;$('#caseImagePreview').classList.remove('hidden');}adminTab('cases');window.scrollTo({top:0,behavior:'smooth'});return;}
    const contents=e.target.closest('[data-case-contents]');if(contents){$('#contentsCase').value=contents.dataset.caseContents;adminTab('contents');await loadCaseItems();window.scrollTo({top:0,behavior:'smooth'});}
    const hideCase=e.target.closest('[data-hide-case]');if(hideCase){if(!confirm('Скрыть кейс для пользователей?'))return;try{await api('/api/admin/cases/'+hideCase.dataset.hideCase,{method:'DELETE'});toast('Кейс скрыт');await refreshAdmin();await loadCases();}catch(err){toast(err.message);}return;}
    const remove=e.target.closest('[data-remove-case-item]');if(remove){try{await api(`/api/admin/cases/${$('#contentsCase').value}/items/${remove.dataset.removeCaseItem}`,{method:'DELETE'});toast('Предмет убран из кейса');await loadCaseItems();await refreshAdmin();}catch(err){toast(err.message);}}
  });
  $('#contentsCase').addEventListener('change',loadCaseItems);
  $('#addCaseItemBtn').addEventListener('click',async()=>{const caseId=$('#contentsCase').value,reward_id=Number($('#contentsItem').value),visual_chance=Number($('#visualChance').value),real_chance=Number($('#realChance').value);if(!caseId||!reward_id){toast('Сначала создай кейс и предмет');return;}try{await api(`/api/admin/cases/${caseId}/items`,{method:'POST',body:JSON.stringify({reward_id,visual_chance,real_chance})});toast('Содержимое кейса сохранено');await loadCaseItems();await refreshAdmin();}catch(e){toast(e.message);}});
  async function loadCaseItems(){const id=$('#contentsCase').value;if(!id){$('#caseItemsList').innerHTML='<div class="empty-state">Создай кейс и добавь предметы.</div>';$('#caseChanceSum').textContent='';return;}try{const items=await api(`/api/admin/cases/${id}/items`);const sum=items.reduce((a,x)=>a+Number(x.real_chance),0);$('#caseChanceSum').textContent=`Сумма реальных шансов: ${sum.toFixed(2)}% ${Math.abs(sum-100)<.01?'— готово к открытию':'— для открытия нужно ровно 100%'}`;$('#caseItemsList').innerHTML=items.length?items.map(i=>`<article class="admin-entry"><img src="${escapeAttr(i.image_url||'')}" alt="" onerror="this.style.display='none'"><div class="admin-entry-main"><b>${escapeHtml(i.name)}</b><span>Визуальный: ${money(i.visual_chance)}% · Реальный: ${money(i.real_chance)}%</span></div><button class="tiny-btn danger" data-remove-case-item="${i.id}">Убрать</button></article>`).join(''):'<div class="empty-state">В этом кейсе пока нет предметов.</div>';}catch(e){$('#caseItemsList').innerHTML=`<div class="empty-state">${escapeHtml(e.message)}</div>`;}}
  async function checkAdmin(){try{const data=await api('/api/admin/status');isAdmin=!!data.isAdmin;$('#adminOpenBtn').classList.toggle('hidden',!isAdmin);}catch{isAdmin=false;}}
  async function boot(){await checkAdmin();await Promise.all([loadMe(),loadRewards(),loadCases()]);if(isAdmin)await refreshAdmin();icons();}
  window.__appApi=api; window.__appToast=toast; window.__appLoadMe=loadMe;
  boot();
})();


// DOUBLE: server-authoritative betting, wheel animation and gradual public activity.
(() => {
  const $ = (s) => document.querySelector(s);
  const colors = ['green','red','black','red','black','red','black','red','black','red','black','red','black','red','black'];
  const labels = Array.from({length:15},(_,i)=>String(i));
  const state = {color:null,roundId:null,remaining:30,spinning:false,rotation:0,balance:0,bots:[],history:[],audio:null,spinOsc:null,spinGain:null};
  const nameLabels = {red:'Красный ×2',black:'Чёрный ×2',green:'Зелёный ×14'};
  function tone(freq=220,duration=.12,volume=.04,type='sine') {
    try { const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=state.audio||(state.audio=new C());if(c.state==='suspended')c.resume();const o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.value=freq;o.connect(g);g.connect(c.destination);g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(volume,c.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+duration);o.start();o.stop(c.currentTime+duration+.02);}catch{}
  }
  function startSpinSound(){try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=state.audio||(state.audio=new C());if(c.state==='suspended')c.resume();const o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.value=95;g.gain.value=.012;o.connect(g);g.connect(c.destination);o.start();state.spinOsc=o;state.spinGain=g;}catch{}}
  function stopSpinSound(){try{if(state.spinOsc){state.spinGain.gain.setTargetAtTime(.0001,state.audio.currentTime,.08);state.spinOsc.stop(state.audio.currentTime+.35);}}catch{}state.spinOsc=null;state.spinGain=null;}
  function wheelMarkup(){
    const wheel=$('#doubleWheel');if(!wheel||wheel.dataset.numbered)return;wheel.dataset.numbered='1';
    labels.forEach((n,i)=>{const el=document.createElement('span');el.className='wheel-number '+colors[i];el.textContent=n;el.style.transform=`translate(-50%,-50%) rotate(${i*24}deg) translateY(-${Math.min(window.innerWidth*.34,118)}px) rotate(180deg)`;wheel.appendChild(el);});
  }
  function addBotBet(){
    if(state.spinning||state.remaining<=3||state.bots.length>=5)return;
    const green=Math.random()<.025;
    const color=green?'green':Math.random()<.5?'red':'black';
    const amount=green?5+Math.floor(Math.random()*6):5+Math.floor(Math.random()*46);
    state.bots.push({color,amount});
    renderBets();
  }
  function renderBets(serverBets=[]){
    const totals={red:0,black:0,green:0},players={red:0,black:0,green:0};
    (serverBets||[]).forEach(b=>{const c=b.color;if(totals[c]!==undefined){totals[c]+=Number(b.total||b.amount||0);players[c]+=Number(b.players||1);}});
    state.bots.forEach(b=>{totals[b.color]+=b.amount;players[b.color]++;});
    ['red','black','green'].forEach(c=>{const p=$('#'+c+'Players'),t=$('#'+c+'Total');if(p)p.textContent=players[c];if(t)t.textContent=Math.round(totals[c]).toLocaleString('ru-RU');});
    const own=serverBets.find(b=>b.mine);if(own){const btn=$(`[data-bet="${own.color}"]`);if(btn)btn.classList.add('own-bet');}
  }
  function openModal(color){
    if(state.spinning||state.remaining<=1){window.__appToast?.('Ставки закрыты — дождись следующего раунда');return;}
    state.color=color;$('#doubleModalTitle').textContent='Ставка на '+nameLabels[color];
    $('#doubleBalance').textContent=Number(state.balance).toLocaleString('ru-RU');
    $('#doubleAmount').value='10';$('#doubleAmount').max=String(state.balance);
    $('#doubleBetModal').classList.remove('hidden');
  }
  async function placeBet(){
    const amount=Number($('#doubleAmount').value);
    if(!Number.isInteger(amount)||amount<5){window.__appToast?.('Минимальная ставка — 5 Искр');return;}
    if(amount>state.balance){window.__appToast?.('Недостаточно Искр на балансе');return;}
    const confirm=$('#doubleConfirm');confirm.disabled=true;
    try{
      const result=await window.__appApi('/api/double/bet',{method:'POST',body:JSON.stringify({color:state.color,amount})});
      state.balance=Number(result.balance);$('#doubleBalance').textContent=state.balance.toLocaleString('ru-RU');
      const bal=$('#balance');if(bal)bal.textContent=state.balance.toLocaleString('ru-RU');
      $('#doubleBetModal').classList.add('hidden');tone(560,.16,.055);
      window.__appToast?.('Ставка принята');
      await refreshState();
    }catch(e){window.__appToast?.(e.message||'Не удалось принять ставку');}
    finally{confirm.disabled=false;}
  }
  function animateResult(number,color){
    if(state.spinning)return;
    state.spinning=true;$('#wheelStatus').textContent='КРУТИМ...';$('#wheelResult').textContent='Крутим...';
    startSpinSound();tone(320,.3,.035,'triangle');
    const wheel=$('#doubleWheel');
    const base=Math.ceil((state.rotation+360*5)/360)*360;
    let target=base-(Number(number)*24);
    if(target<=state.rotation)target+=360;
    state.rotation=target;
    wheel.style.transition='transform 5.4s cubic-bezier(.12,.72,.1,1)';
    wheel.style.transform=`rotate(${state.rotation}deg)`;
    setTimeout(()=>{
      stopSpinSound();tone(color==='green'?980:color==='red'?720:610,.3,.07);
      $('#wheelResult').textContent=String(number);$('#wheelStatus').textContent='ВЫИГРАЛ '+({red:'КРАСНЫЙ',black:'ЧЁРНЫЙ',green:'ЗЕЛЁНЫЙ'}[color]||'');
      state.history.unshift({n:number,color});state.history=state.history.slice(0,10);
      $('#doubleHistory').innerHTML=state.history.map(x=>`<span class="${x.color==='red'?'red-ball':x.color==='green'?'green-ball':''}">${x.n}</span>`).join('');
      state.spinning=false;state.bots=[];
      setTimeout(()=>{if(!state.spinning){$('#wheelResult').textContent=String(state.remaining);$('#wheelStatus').textContent='СЕК. ДО ПРОКРУТА';tone(480,.12,.025);}},900);
    },5500);
  }
  async function refreshState(){
    try{
      const data=await window.__appApi('/api/double/state');
      state.balance=Number(data.balance||0);
      const bal=$('#balance');if(bal)bal.textContent=state.balance.toLocaleString('ru-RU');
      const oldRound=state.roundId;state.roundId=Number(data.roundId);state.remaining=Number(data.remaining||0);
      if(oldRound!==null&&oldRound!==state.roundId&&Array.isArray(data.history)&&data.history.length){
        const last=data.history[0],n=Number(last.winning_number),c=last.winning_color;
        if(Number.isInteger(n)&&!state.spinning)animateResult(n,c);
        state.bots=[];
      }
      if(!state.spinning){$('#wheelResult').textContent=String(state.remaining);$('#wheelStatus').textContent='СЕК. ДО ПРОКРУТА';}
      const mine=data.mine;
      const serverBets=(data.bets||[]).map(b=>({...b,players:Number(b.players),total:Number(b.total)}));
      if(mine){const row=serverBets.find(x=>x.color===mine.color);if(row)row.mine=true;}
      renderBets(serverBets);
      if(!state.history.length&&Array.isArray(data.history)){state.history=data.history.map(x=>({n:Number(x.winning_number),color:x.winning_color}));$('#doubleHistory').innerHTML=state.history.map(x=>`<span class="${x.color==='red'?'red-ball':x.color==='green'?'green-ball':''}">${x.n}</span>`).join('');}
      document.querySelectorAll('[data-bet]').forEach(b=>b.disabled=state.spinning||state.remaining<=1||!!mine);
    }catch(e){if(!window.__doubleWarned){window.__doubleWarned=true;window.__appToast?.(e.message||'DOUBLE требует подключённую базу данных');}}
  }
  document.addEventListener('click',e=>{
    const bet=e.target.closest('[data-bet]');if(bet)openModal(bet.dataset.bet);
    const preset=e.target.closest('[data-preset]');if(preset){const input=$('#doubleAmount'),bal=state.balance,v=Number(input.value||0);if(preset.dataset.preset==='add')input.value=Math.min(bal,v+10);else if(preset.dataset.preset==='max')input.value=bal;else input.value=Math.min(bal,Math.max(5,Math.floor(bal*Number(preset.dataset.preset)/100)));}
  });
  $('#doubleModalClose')?.addEventListener('click',()=>$('#doubleBetModal').classList.add('hidden'));
  $('#doubleConfirm')?.addEventListener('click',placeBet);
  wheelMarkup();refreshState();
  setInterval(()=>{if(!state.spinning){state.remaining=Math.max(0,state.remaining-1);if(state.remaining>=0&&state.roundId!==null){$('#wheelResult').textContent=String(state.remaining);$('#wheelStatus').textContent='СЕК. ДО ПРОКРУТА';}if(state.remaining<=0)refreshState();}},1000);
  setInterval(refreshState,2500);
  (function scheduleBot(){setTimeout(()=>{addBotBet();scheduleBot();},2200+Math.random()*3800);})();
  // Free case uses the existing server-side subscription, cooldown and admin-configured reward pool.
  async function loadFreeCasePreview(){
    const rail=$('#freeCaseRoulette');if(!rail)return;
    try{
      const data=await window.__appApi('/api/free-case/contents');
      const rewards=Array.isArray(data.rewards)?data.rewards:[];
      if(!rewards.length){rail.innerHTML='<span>✦</span><span>🎁</span><span>💎</span><span>⚡</span><span>🎁</span>';return;}
      const strip=Array.from({length:9},(_,i)=>rewards[i%rewards.length]);
      rail.innerHTML=strip.map(r=>`<span title="${String(r.name||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">${r.image_url?`<img src="${r.image_url}" alt="">`:'✦'}</span>`).join('');
    }catch{rail.innerHTML='<span>✦</span><span>🎁</span><span>💎</span><span>⚡</span><span>🎁</span>';}
  }
  loadFreeCasePreview();
  $('#verifySubscriptionBtn')?.addEventListener('click',async()=>{
    const status=$('#freeCaseStatus'),btn=$('#openFreeCaseBtn');status.textContent='Проверка подписки…';
    try{
      const [sub,cd]=await Promise.all([window.__appApi('/api/subscription'),window.__appApi('/api/free-case/status')]);
      if(sub.subscribed){status.textContent=cd.available?'Подписка подтверждена. Можно открыть кейс.':`Кейс уже открыт. Следующее открытие: ${new Date(cd.nextAt).toLocaleString('ru-RU')}`;btn.disabled=!cd.available;btn.textContent=cd.available?'Открыть бесплатный кейс':'Уже открыт сегодня';btn.dataset.verified=cd.available?'1':'';}
      else{status.textContent='Подписка не найдена. Подпишись на @BELIVEIN_OG и попробуй снова.';btn.disabled=true;btn.dataset.verified='';}
    }catch(err){status.textContent=err.message||'Не удалось проверить подписку. Открой Mini App из Telegram.';}
  });
  $('#openFreeCaseBtn')?.addEventListener('click',async()=>{
    const btn=$('#openFreeCaseBtn'),status=$('#freeCaseStatus'),rail=$('#freeCaseRoulette');
    if(btn.dataset.verified!=='1'){status.textContent='Сначала нажми Verify Subscription.';return;}
    btn.disabled=true;status.textContent='Кейс открывается…';rail?.classList.add('rolling');tone(260,.18,.03);
    try{
      const result=await window.__appApi('/api/free-case/open',{method:'POST',body:JSON.stringify({})});
      setTimeout(()=>{
        rail?.classList.remove('rolling');
        if(rail)rail.innerHTML=`<span>${result.reward.image_url?`<img src="${result.reward.image_url}" alt="">`:'✦'}</span><strong>${String(result.reward.name||'Приз')}</strong><b>${Number(result.reward.value||0).toLocaleString('ru-RU')} ✦</b>`;
        status.textContent=`Выигрыш: ${result.reward.name} · ${result.reward.value} Искр. Следующее открытие через 24 часа.`;
        btn.textContent='Уже открыт сегодня';btn.dataset.verified='';
        tone(900,.28,.06);window.__appLoadMe?.();
      },2200);
    }catch(err){rail?.classList.remove('rolling');status.textContent=err.message;btn.disabled=false;}
  });
})();
