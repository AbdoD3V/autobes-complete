// main.js - Arabic Atobes Complete game (client-side)

const letters = [
    'ا','ب','ت','ث','ج','ح','خ','د','ذ','ر','ز','س','ش','ص','ض','ط','ظ','ع','غ','ف','ق','ك','ل','م','ن','ه','و','ي'
];

let state = {
    roomId: null,
    owner: null,
    players: [],
    currentRound: 0,
    letterIndex: 0,
    timer: null,
    timeLeft: 180,
    submissions: {},
    scores: {},
    aiHints: {}, // tracks AI-help tokens per player
};

// --- Helpers ---
const $ = id => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

function uid() { return Math.random().toString(36).slice(2,9); }

// --- Lobby UI ---
$('create-room').addEventListener('click', ()=>{ show($('room-creator')); hide($('room-join')); });
$('join-room').addEventListener('click', ()=>{ show($('room-join')); hide($('room-creator')); });
$('finish-create').addEventListener('click', createRoom);
$('finish-join').addEventListener('click', joinRoom);
$('start-game').addEventListener('click', startGame);
$('answers-form').addEventListener('submit', submitAnswers);

function renderPlayers(){
    const el = $('players-list');
    el.innerHTML = '';
    state.players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.textContent = `${p.name} ${p.id===state.owner? '(صاحب الغرفة)':''}`;
        el.appendChild(div);
    });
}

function createRoom(){
    const name = $('player-name').value.trim() || 'لاعب';
    const pass = $('room-password').value;
    state.roomId = uid().toUpperCase();
    state.owner = uid(); // local owner id
    const ownerObj = { id: state.owner, name };
    state.players = [ownerObj];
    state.scores = { [state.owner]: 0 };
    show($('lobby-info'));
    $('room-id-display').textContent = `رمز الغرفة: ${state.roomId}`;
    renderPlayers();
}

function joinRoom(){
    const name = $('player-name').value.trim() || 'لاعب';
    const rid = $('join-room-id').value.trim();
    if(!rid){ alert('أدخل رمز الغرفة'); return; }
    // local simulated join: add a player
    const pid = uid();
    state.players.push({ id: pid, name });
    state.scores[pid] = 0;
    state.roomId = rid;
    $('room-id-display').textContent = `رمز الغرفة: ${state.roomId}`;
    show($('lobby-info'));
    renderPlayers();
}

// --- Game flow ---
function startGame(){
    if(state.players.length < 2){ alert('يجب أن يكون هناك لاعبان على الأقل.'); return; }
    state.currentRound = 1;
    state.letterIndex = 0;
    state.submissions = {};
    show($('game'));
    hide(document.querySelector('.lobby'));
    nextRound();
}

function nextRound(){
    if(state.currentRound > letters.length){ endGame(); return; }
    const letter = letters[state.letterIndex % letters.length];
    $('letter-card').textContent = `الحرف: ${letter}`;
    $('round-info').textContent = `جولة ${state.currentRound} من ${letters.length}`;
    state.timeLeft = 180; // 3 minutes
    startTimer(()=> onRoundTimeout());
    // reset submissions for this round
    state.submissions = {};
}

function startTimer(onEnd){
    const timerEl = $('timer');
    clearInterval(state.timer);
    state.timer = setInterval(()=>{
        state.timeLeft -= 1;
        const m = String(Math.floor(state.timeLeft/60)).padStart(2,'0');
        const s = String(state.timeLeft%60).padStart(2,'0');
        timerEl.textContent = `${m}:${s}`;
        if(state.timeLeft<=0){ clearInterval(state.timer); onEnd(); }
    },1000);
}

async function onRoundTimeout(){
    // collect answers and validate via HF
    const subs = state.submissions; // map playerId -> answers
    const letter = letters[state.letterIndex % letters.length];
    const results = {};
    const fields = ['boy','girl','plant','solid','place'];
    const numFields = fields.length;

    for(const p of state.players){
        const pid = p.id;
        const answers = subs[pid] || {};
        results[pid] = { raw: answers, validated: {} };
        // for each field, call validation
        for(const field of ['boy','girl','plant','solid','place']){
            const word = (answers[field]||'').trim();
            if(!word){ results[pid].validated[field] = { ok:false, reason:'فارغ' }; continue; }
            // quick check: starts with the letter
            if(word[0] !== letter){ results[pid].validated[field] = { ok:false, reason:`لا يبدأ بالحرف ${letter}` }; continue; }
            // call HF validation
            try{
                const res = await validateWithHF(word, field);
                results[pid].validated[field] = res;
            }catch(err){ results[pid].validated[field] = { ok:false, reason:'خطأ في التحقق' }; }
        }
    }

    // scoring: build map of answers per field to count duplicates
    const fieldMap = { boy:{}, girl:{}, plant:{}, solid:{}, place:{} };
    for(const pid of Object.keys(results)){
        for(const f of Object.keys(fieldMap)){
            const v = (results[pid].raw[f]||'').trim();
            const ok = results[pid].validated[f] && results[pid].validated[f].ok;
            if(!ok) continue;
            fieldMap[f][v] = (fieldMap[f][v]||0) + 1;
        }
    }

    // assign points and track round points per player
    const roundPoints = {};
    for(const pid of Object.keys(results)) roundPoints[pid]=0;

    for(const pid of Object.keys(results)){
        for(const f of Object.keys(fieldMap)){
            const v = (results[pid].raw[f]||'').trim();
            const ok = results[pid].validated[f] && results[pid].validated[f].ok;
            if(!ok) continue;
            const cnt = fieldMap[f][v] || 0;
            const points = cnt === 1 ? 10 : 5;
            state.scores[pid] = (state.scores[pid]||0) + points;
            roundPoints[pid] = (roundPoints[pid]||0) + points;
        }
    }

    // award AI  help token if player got full unique answers (10 points for every field)
    for(const pid of Object.keys(roundPoints)){
        if(roundPoints[pid] === numFields * 10){
            state.aiHints[pid] = (state.aiHints[pid]||0) + 1;
            // annotate results so UI can show it
            results[pid].awardedAI = true;
        }
    }

    // render round results (include per-player round points)
    renderRoundResults(results, fieldMap, roundPoints);

    // advance
    state.currentRound += 1;
    state.letterIndex += 1;
}

function renderRoundResults(results, fieldMap, roundPoints){
    const el = $('round-results');
    el.classList.remove('hidden');
    el.innerHTML = '';

    const table = document.createElement('div');
    table.className = 'results-table';
    for(const p of state.players){
        const pid = p.id;
        const row = document.createElement('div');
        row.className = 'result-row';
        const name = document.createElement('div'); name.className='res-name'; name.textContent = p.name;
        const score = document.createElement('div'); score.className='res-score'; score.textContent = `الإجمالي: ${state.scores[pid]||0} نقاط`;
        // round points
        const rpts = document.createElement('div'); rpts.className='round-points'; rpts.textContent = `نقاط الجولة: ${roundPoints[pid]||0}`;
        if(state.aiHints[pid]){
            const hintBadge = document.createElement('div'); hintBadge.className='ai-badge'; hintBadge.textContent = `مساعدة AI: ${state.aiHints[pid]}`;
            row.appendChild(hintBadge);
        }
        row.appendChild(name);
        row.appendChild(rpts);
        row.appendChild(score);
        const list = document.createElement('ul');
        for(const f of ['boy','girl','plant','solid','place']){
            const li = document.createElement('li');
            const raw = results[pid].raw[f]||'';
            const vres = results[pid].validated[f];
            li.textContent = `${f}: ${raw} → ${vres && vres.ok ? 'صحيح' : 'خاطئ'} ${vres && vres.reason? '('+vres.reason+')':''}`;
            list.appendChild(li);
        }
        row.appendChild(list);
        table.appendChild(row);
    }

    el.appendChild(table);

    // show next round button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = state.currentRound > letters.length ? 'انتهت اللعبة' : 'الجولة التالية';
    nextBtn.addEventListener('click', ()=>{
        if(state.currentRound > letters.length){ endGame(); } else { el.classList.add('hidden'); nextRound(); }
    });
    el.appendChild(nextBtn);
}

function endGame(){
    clearInterval(state.timer);
    alert('انتهت اللعبة — قوائم النتائج أدناه.');
    // show final ranking
    const ranking = Object.entries(state.scores).map(([id,score])=>({id,score,name:(state.players.find(p=>p.id===id)||{}).name||'لاعب'}))
        .sort((a,b)=>b.score-a.score);
    const msg = ranking.map((r,i)=>`${i+1}. ${r.name} — ${r.score} نقاط`).join('\n');
    alert(msg);
}

// --- Submissions (simulated per-player on same device) ---
function submitAnswers(e){
    e.preventDefault();
    // assume single local player is the last added player
    const player = state.players[state.players.length-1];
    if(!player){ alert('انضم إلى الغرفة أولاً.'); return; }
    const form = e.target;
    const data = new FormData(form);
    const answers = {};
    for(const key of ['boy','girl','plant','solid','place']) answers[key] = data.get(key) || '';
    state.submissions[player.id] = answers;
    alert('تم حفظ إجاباتك للجولة.');
}

// --- Validation via Netlify function which calls Hugging Face ---
async function validateWithHF(word, field){
    const payload = { text: word, field };
    const resp = await fetch('/.netlify/functions/validate', {
        method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if(!resp.ok) throw new Error('Validation failed');
    const data = await resp.json();
    return data; // { ok: bool, reason: string, suggestions: [] }
}

// --- Minimal Three.js background ---
function initThree(){
    const canvas = document.getElementById('bg-canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 1000);
    camera.position.z = 5;
    const geo = new THREE.SphereGeometry(1.6, 32, 32);
    const mat = new THREE.MeshBasicMaterial({ color:0x5cc1ff, wireframe:true, opacity:0.08, transparent:true });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    function onResize(){
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.aspect = window.innerWidth/window.innerHeight;
        camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', onResize);
    onResize();

    function animate(){
        mesh.rotation.x += 0.002;
        mesh.rotation.y += 0.003;
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
    }
    animate();
}

initThree();

// expose some helpers to developer console for testing
window._gameState = state;
window._letters = letters;

console.log('نظام اللعبة جاهز بالعربية.');
