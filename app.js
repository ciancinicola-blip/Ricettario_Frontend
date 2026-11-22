'use strict';

/* ==========================================================================
   COSTANTI
   ========================================================================== */

const VALID_USERS = ['Sara', 'Elena', 'Nicola', 'Anna'];
// Password protetta con SHA-256.
// Hash SHA-256 di '7264':
const PASSWORD_HASH = '19dc1c2e10e78610594dd7b574b7166e298b1fd7b0f73cdba9fe8e91eb10ecee';
// Lunedì 9 novembre 2026: inizio del ciclo di 4 settimane
const ANCHOR_MONDAY = new Date(2026, 10, 9);

const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
const CATEGORIES = [['ALL', 'Tutte'], ['Primo Piatto', 'Primi'], ['Secondo Piatto', 'Secondi'], ['Contorno', 'Contorni']];
const TAGS = [['ALL', 'Tutti'], ['pesce', 'Pesce'], ['carne', 'Carne'], ['vegetariano', 'Vegetariano'], ['veloce', 'Veloce (≤ 20 min)']];

const FISH_RE = /pesce|salmone|tonno|merluzzo|branzin|orata|sgombro|sarde|alici|gamber|calamar|cozze|vongole|totan|seppi|baccal|platessa|sogliola|nasello|spada|acciug|mazzancol/i;
const MEAT_RE = /pollo|manzo|maiale|vitello|tacchino|coniglio|prosciutto|guanciale|pancetta|salsiccia|macinato|fesa|controfiletto|arista|cosce|fusi|sovracoscia|hamburger|bocconcini|straccetti|scannello|girello|cappello del prete|roast/i;

const DEFAULT_PANTRY = ["Olio extravergine d'oliva", 'Olio EVO', 'Sale', 'Pepe', 'Aglio', 'Vino bianco'];

/* ==========================================================================
   STORAGE E UTILITY
   ========================================================================== */

const store = {
    get(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage pieno o disabilitato */ }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* ignora */ }
    }
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const fmtNum = n => (Math.round(n * 10) / 10).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const minutes = s => parseInt(s, 10) || 0;

/* ==========================================================================
   STATO
   ========================================================================== */

let recipesData = [];
let currentUser = null;
let activeWeekIndex = 0;
let shoppingWeek = null;
let weeklyPlan = store.get('cianci_weekly_plan', {});
let checkedShopping = store.get('cianci_checked_shopping', {});
let pantry = store.get('cianci_pantry', DEFAULT_PANTRY);
let cookFilter = { cat: 'ALL', tag: 'ALL' };

let currentRecipeId = null;
let currentServings = 4;
let cookMode = false;
let cookStep = 0;
let wakeLock = null;
let showCookIngredients = false;
let cookTimer = {
    intervalId: null,
    totalSeconds: 0,
    remainingSeconds: 0,
    isRunning: false,
    alarmTriggered: false
};

/* ==========================================================================
   SETTIMANE (ciclo rolling di 4 settimane)
   ========================================================================== */

function getMonday(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
    d.setDate(d.getDate() + diff);
    return d;
}

function getRollingWeeks(date) {
    const monday = getMonday(date);
    const diffWeeks = Math.round((monday - getMonday(ANCHOR_MONDAY)) / (7 * 864e5));
    const cycle = ((diffWeeks % 4) + 4) % 4;

    return Array.from({ length: 4 }, (_, i) => {
        const start = new Date(monday);
        start.setDate(monday.getDate() + i * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return {
            id: ((cycle + i) % 4) + 1,
            label: `${start.getDate()}-${end.getDate()} ${MONTHS[end.getMonth()]}`,
            start,
            end
        };
    });
}

function currentWeeks() {
    return getRollingWeeks(new Date());
}

/* ==========================================================================
   RICETTE E PIANO SETTIMANALE
   ========================================================================== */

function getRecipe(id) {
    return recipesData.find(r => r.id === id);
}

function getTags(r) {
    const text = [r.title, ...r.ingredients].join(' ');
    const fish = FISH_RE.test(text);
    const meat = MEAT_RE.test(text);
    const tags = [];
    if (fish) tags.push('pesce');
    if (meat) tags.push('carne');
    if (!fish && !meat) tags.push('vegetariano');
    if (minutes(r.prep_time) + minutes(r.cook_time) <= 20) tags.push('veloce');
    return tags;
}

function ensureWeekPlan(weekId) {
    if (weeklyPlan[weekId] && weeklyPlan[weekId].length === 7) {
        // Migrazione: garantisce la presenza di contorni anche nei piani salvati in precedenza
        const contorni = recipesData.filter(r => r.category === 'Contorno');
        if (contorni.length) {
            let modified = false;
            weeklyPlan[weekId].forEach((d, idx) => {
                if (!d.sideId) {
                    d.sideId = contorni[idx % contorni.length].id;
                    modified = true;
                }
            });
            if (modified) store.set('cianci_weekly_plan', weeklyPlan);
        }
        return;
    }
    regenerateWeek(weekId);
}

function regenerateWeek(weekId) {
    const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);
    const primi = shuffle(recipesData.filter(r => r.category === 'Primo Piatto'));
    const secondi = shuffle(recipesData.filter(r => r.category === 'Secondo Piatto'));
    const contorni = shuffle(recipesData.filter(r => r.category === 'Contorno'));
    if (!primi.length || !secondi.length) return;

    const existingWeek = weeklyPlan[weekId] || [];

    weeklyPlan[weekId] = Array.from({ length: 7 }, (_, d) => {
        const ex = existingWeek[d];
        return {
            lunchId: (ex && ex.lockedLunch) ? ex.lunchId : primi[d % primi.length].id,
            dinnerId: (ex && ex.lockedDinner) ? ex.dinnerId : secondi[d % secondi.length].id,
            sideId: (ex && ex.lockedSide) ? ex.sideId : (contorni.length ? contorni[d % contorni.length].id : null),
            lockedLunch: Boolean(ex?.lockedLunch),
            lockedDinner: Boolean(ex?.lockedDinner),
            lockedSide: Boolean(ex?.lockedSide)
        };
    });
    store.set('cianci_weekly_plan', weeklyPlan);
    renderApp();
}

function swapMeal(weekId, dayIdx, meal) {
    ensureWeekPlan(weekId);
    const dayPlan = weeklyPlan[weekId][dayIdx];
    const isLunch = meal === 'lunch';
    const isSide = meal === 'side';
    const field = isLunch ? 'lunchId' : (isSide ? 'sideId' : 'dinnerId');
    const lockField = isLunch ? 'lockedLunch' : (isSide ? 'lockedSide' : 'lockedDinner');

    if (dayPlan[lockField]) {
        alert('Questo piatto è bloccato. Tocca il lucchetto per sbloccarlo se desideri sostituirlo.');
        return;
    }

    let category = 'Secondo Piatto';
    if (isLunch) category = 'Primo Piatto';
    else if (isSide) category = 'Contorno';

    const current = dayPlan[field];
    const options = recipesData.filter(r => r.category === category && r.id !== current);
    if (!options.length) return;

    dayPlan[field] = options[Math.floor(Math.random() * options.length)].id;
    store.set('cianci_weekly_plan', weeklyPlan);
    renderApp();
}

function toggleLock(weekId, dayIdx, meal) {
    ensureWeekPlan(weekId);
    const dayPlan = weeklyPlan[weekId][dayIdx];
    const lockField = meal === 'lunch' ? 'lockedLunch' : (meal === 'side' ? 'lockedSide' : 'lockedDinner');
    dayPlan[lockField] = !dayPlan[lockField];
    store.set('cianci_weekly_plan', weeklyPlan);
    renderApp();
}

/* ==========================================================================
   INGREDIENTI: parsing, scalatura, aggregazione
   ========================================================================== */

// Converte "320g Pasta", "1kg Vongole", "2 Uova" in { qty, unit, name, key }.
// Le unità sono normalizzate: g per i pesi, ml per i volumi, pz per i conteggi.
function parseIngredient(raw) {
    const s = String(raw).trim();

    let m = s.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|cl|ml|l)\b\s*(.*)$/i);
    if (m) {
        const n = parseFloat(m[1].replace(',', '.'));
        const u = m[2].toLowerCase();
        const [factor, unit] = { kg: [1000, 'g'], g: [1, 'g'], cl: [10, 'ml'], ml: [1, 'ml'], l: [1000, 'ml'] }[u];
        return makeIngredient(n * factor, unit, m[3] || s);
    }

    m = s.match(/^(\d+)\s+(.*)$/);
    if (m) return makeIngredient(parseInt(m[1], 10), 'pz', m[2]);

    return makeIngredient(null, null, s);
}

function makeIngredient(qty, unit, name) {
    const cleanName = name.replace(/\bq\.b\.?/gi, '').replace(/\s+/g, ' ').trim();
    const key = cleanName.replace(/\(.*?\)/g, '').replace(/[,\s]+$/, '').trim().toLowerCase() || cleanName.toLowerCase();
    return { qty, unit, name: cleanName, key };
}

function formatQty(qty, unit) {
    if (unit === 'g' && qty >= 1000) return `${fmtNum(qty / 1000)} kg`;
    if (unit === 'ml' && qty >= 1000) return `${fmtNum(qty / 1000)} l`;
    if (unit === 'pz') return fmtNum(qty);
    return `${fmtNum(qty)} ${unit}`;
}

function scaleIngredient(raw, factor) {
    const p = parseIngredient(raw);
    if (p.qty === null) return raw;
    return `${formatQty(p.qty * factor, p.unit)} ${p.name}`;
}

function buildShopping(week) {
    const map = new Map();
    (weeklyPlan[week.id] || []).forEach(day => {
        [day.lunchId, day.dinnerId, day.sideId].filter(Boolean).forEach(id => {
            const r = getRecipe(id);
            if (!r) return;
            r.ingredients.forEach(raw => {
                const p = parseIngredient(raw);
                if (!map.has(p.key)) {
                    map.set(p.key, { key: p.key, name: p.name, unit: p.unit, qty: 0, occ: 0, mixed: false });
                }
                const item = map.get(p.key);
                item.occ += 1;
                if (p.qty === null || p.unit !== item.unit) item.mixed = true;
                if (p.qty !== null) item.qty += p.qty;
            });
        });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

function shoppingText(item) {
    if (!item.mixed && item.qty > 0) return `${formatQty(item.qty, item.unit)} ${item.name}`;
    return item.occ > 1 ? `${item.name} (x${item.occ})` : item.name;
}

function isInPantry(key) {
    return pantry.some(p => p && key.includes(p.toLowerCase()));
}

/* ==========================================================================
   RENDER: SETTIMANE E MENÙ
   ========================================================================== */

function renderApp() {
    const weeks = currentWeeks();
    if (activeWeekIndex > 3) activeWeekIndex = 0;
    const week = weeks[activeWeekIndex];
    ensureWeekPlan(week.id);

    document.getElementById('shoppingBadgeWeek').textContent = `Sett. ${week.id}`;
    renderTabs(weeks);
    renderWeek(week);
}

function renderTabs(weeks) {
    document.getElementById('weekTabs').innerHTML = weeks.map((w, idx) => {
        const active = idx === activeWeekIndex;
        return `
            <button data-action="week" data-idx="${idx}" aria-pressed="${active}"
                class="px-4 py-2 rounded-2xl font-bold text-xs sm:text-sm whitespace-nowrap transition flex items-center gap-2 ${active ? 'bg-teal-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'}">
                <i class="fa-regular fa-calendar"></i> ${w.label}
                <span class="text-[11px] px-2 py-0.5 rounded-full ${active ? 'bg-teal-600 text-teal-50' : 'bg-white text-slate-600'}">Sett. ${w.id}</span>
            </button>`;
    }).join('');
}

function mealCard(r, weekId, dayIdx, meal) {
    if (!r) return '';
    const isLunch = meal === 'lunch';
    const isSide = meal === 'side';
    const dayPlan = weeklyPlan[weekId]?.[dayIdx] || {};
    const isLocked = isLunch ? Boolean(dayPlan.lockedLunch) : (isSide ? Boolean(dayPlan.lockedSide) : Boolean(dayPlan.lockedDinner));

    let box, label, labelColor;
    if (isLunch) {
        box = 'bg-amber-50/50 border-amber-200/70 hover:bg-amber-50';
        label = '<i class="fa-solid fa-sun text-amber-500"></i> Pranzo';
        labelColor = 'text-amber-700';
    } else if (isSide) {
        box = 'bg-emerald-50/50 border-emerald-200/70 hover:bg-emerald-50';
        label = '<i class="fa-solid fa-leaf text-emerald-500"></i> Contorno';
        labelColor = 'text-emerald-700';
    } else {
        box = 'bg-teal-50/40 border-teal-200/60 hover:bg-teal-50/80';
        label = '<i class="fa-solid fa-moon text-indigo-400"></i> Cena';
        labelColor = 'text-teal-700';
    }

    return `
        <div class="p-3 rounded-2xl border transition ${box} flex flex-col justify-between">
            <div class="flex items-center justify-between gap-1">
                <span class="text-[11px] font-bold uppercase flex items-center gap-1 ${labelColor}">${label}</span>
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" data-action="toggle-lock" data-week="${weekId}" data-day="${dayIdx}" data-meal="${meal}"
                        title="${isLocked ? 'Piatto bloccato (clicca per sbloccare)' : 'Blocca piatto (non verrà rimescolato)'}"
                        aria-label="${isLocked ? 'Sblocca piatto' : 'Blocca piatto'}"
                        class="w-7 h-7 rounded-lg border flex items-center justify-center transition text-[11px] ${isLocked ? 'bg-amber-200/90 border-amber-400 text-amber-900 font-bold shadow-sm' : 'bg-white/80 border-slate-200 text-slate-400 hover:text-amber-600 hover:border-amber-300'}">
                        <i class="fa-solid ${isLocked ? 'fa-lock' : 'fa-lock-open'}"></i>
                    </button>
                    <button type="button" data-action="swap" data-week="${weekId}" data-day="${dayIdx}" data-meal="${meal}"
                        title="${isLocked ? 'Piatto bloccato (sbloccalo prima di cambiarlo)' : 'Cambia ricetta'}"
                        aria-label="Cambia ricetta"
                        ${isLocked ? 'disabled' : ''}
                        class="w-7 h-7 rounded-lg bg-white/80 border border-slate-200 flex items-center justify-center text-slate-500 hover:text-teal-600 hover:border-teal-300 disabled:opacity-30 disabled:pointer-events-none transition text-[11px]">
                        <i class="fa-solid fa-rotate"></i>
                    </button>
                </div>
            </div>
            <div role="button" tabindex="0" data-action="open-recipe" data-id="${r.id}" class="cursor-pointer pt-1">
                <h5 class="font-bold text-xs text-slate-800 mt-1.5 leading-snug hover:text-teal-700 transition">${esc(r.title)}</h5>
                <div class="mt-2 pt-2 border-t border-slate-200/50 space-y-1">
                    <p class="text-[11px] font-bold text-slate-600"><i class="fa-solid fa-bolt text-amber-500 mr-1"></i>${esc(r.nutrition.calories)} · ${esc(r.nutrition.protein)} prot.</p>
                    <p class="text-[11px] text-slate-500 line-clamp-1">${esc(r.ingredients.slice(0, 2).join(', '))}...</p>
                    <p class="text-[11px] font-medium text-slate-500"><i class="fa-regular fa-clock mr-1"></i>${esc(r.cook_time)}</p>
                </div>
            </div>
        </div>`;
}

function renderWeek(week) {
    const plan = weeklyPlan[week.id];
    const fmtDate = d => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });

    let lockedCount = 0;
    const days = DAYS.map((dayName, d) => {
        const dayPlan = plan[d] || {};
        if (dayPlan.lockedLunch) lockedCount++;
        if (dayPlan.lockedDinner) lockedCount++;
        if (dayPlan.lockedSide) lockedCount++;

        return `
            <div class="bg-white rounded-3xl card-soft p-4 flex flex-col space-y-3">
                <div class="flex items-center justify-between pb-2.5 border-b border-slate-100">
                    <h4 class="font-bold text-slate-800 text-sm">${dayName}</h4>
                    <span class="text-[11px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">G${d + 1}</span>
                </div>
                ${mealCard(getRecipe(dayPlan.lunchId), week.id, d, 'lunch')}
                ${mealCard(getRecipe(dayPlan.dinnerId), week.id, d, 'dinner')}
                ${mealCard(getRecipe(dayPlan.sideId), week.id, d, 'side')}
            </div>`;
    }).join('');

    const lockedBadge = lockedCount > 0
        ? `<span class="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-100 border border-amber-300 px-3 py-1 rounded-full shadow-sm">
             <i class="fa-solid fa-lock text-amber-600"></i> ${lockedCount} ${lockedCount === 1 ? 'piatto bloccato' : 'piatti bloccati'}
           </span>`
        : '';

    document.getElementById('weekContent').innerHTML = `
        <div class="bg-teal-50/80 border border-teal-200/80 rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-teal-700 bg-teal-100/80 px-3 py-1 rounded-full">Ciclo · Settimana ${week.id}</span>
                    ${lockedBadge}
                </div>
                <h3 class="text-lg font-bold text-slate-800 mt-2">Dal ${fmtDate(week.start)} al ${fmtDate(week.end)}</h3>
                <p class="text-xs font-medium text-slate-600 mt-0.5">Tocca un piatto per la ricetta, 🔄 per cambiarlo, oppure 🔒 per bloccarlo durante il rimescola.</p>
            </div>
            <div class="flex flex-wrap gap-2 shrink-0">
                <button data-action="regen" data-week="${week.id}" class="px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold rounded-xl border border-slate-200 text-xs flex items-center gap-1.5 transition">
                    <i class="fa-solid fa-shuffle text-teal-600"></i> Rimescola
                </button>
                <button data-action="shopping" class="px-4 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold rounded-xl border border-amber-200 text-xs flex items-center gap-2 transition">
                    <i class="fa-solid fa-cart-shopping text-amber-700"></i> Spesa settimana ${week.id}
                </button>
            </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 mobile-week-grid">${days}</div>`;
}

/* ==========================================================================
   RICETTA: modale con porzioni e modalità cucina
   ========================================================================== */

function openRecipe(id) {
    const r = getRecipe(id);
    if (!r) return;
    currentRecipeId = id;
    currentServings = r.servings || 4;
    cookMode = false;
    cookStep = 0;
    showCookIngredients = false;
    stopCookTimer();
    cookTimer.totalSeconds = 0;
    cookTimer.remainingSeconds = 0;
    cookTimer.alarmTriggered = false;
    renderRecipeBody();
    openModal('recipeModal');
}

function renderRecipeBody() {
    const r = getRecipe(currentRecipeId);
    if (!r) return;

    const factor = currentServings / (r.servings || 4);
    const header = `
        <div class="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div class="min-w-0">
                <span class="text-xs font-bold text-teal-700 bg-teal-50 px-3 py-1 rounded-full border border-teal-200/70 uppercase">${esc(r.category)}</span>
                <h3 id="recipeTitle" class="font-bold text-xl text-slate-800 mt-2">${esc(r.title)}</h3>
            </div>
            <button data-action="close" data-modal="recipeModal" class="modal-close shrink-0" aria-label="Chiudi"><i class="fa-solid fa-xmark"></i></button>
        </div>`;

    let body;
    if (cookMode) {
        body = cookModeHtml(r);
    } else {
        const servingsBtns = [2, 3, 4, 5, 6].map(n => `
            <button data-action="servings" data-value="${n}" aria-pressed="${n === currentServings}"
                class="px-3 py-1.5 rounded-xl text-xs font-bold border transition ${n === currentServings ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}">${n}</button>`).join('') + `
            <div class="flex items-center gap-1 ml-1">
                <input type="number" id="customServings" min="1" max="20" value="${currentServings}"
                    class="w-14 py-1.5 px-2 rounded-xl text-xs font-bold border border-slate-200 focus:border-teal-500 outline-none text-center"
                    aria-label="Porzioni personalizzate">
                <button data-action="servings-custom" class="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-teal-50 border border-slate-200 transition">✓</button>
            </div>`;

        const ingredients = r.ingredients.map(i => `
            <li class="text-xs bg-slate-50/70 p-2.5 rounded-xl border border-slate-200/70 font-semibold text-slate-700 flex items-center gap-2">
                <i class="fa-solid fa-check text-teal-500 text-xs"></i>${esc(scaleIngredient(i, factor))}
            </li>`).join('');

        const steps = r.steps.map((s, idx) => `
            <li class="text-xs bg-white p-3 rounded-xl border border-slate-200/80 font-medium text-slate-700 flex gap-3">
                <span class="font-bold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-lg border border-teal-200/70 h-fit">${idx + 1}</span>
                <span class="self-center leading-relaxed">${esc(s)}</span>
            </li>`).join('');

        const n = r.nutrition;
        body = `
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/80 text-center font-semibold text-xs">
                <div><span class="block text-[11px] text-slate-400 uppercase">Preparazione</span><span class="text-slate-700">${esc(r.prep_time)}</span></div>
                <div><span class="block text-[11px] text-slate-400 uppercase">Cottura</span><span class="text-slate-700">${esc(r.cook_time)}</span></div>
                <div><span class="block text-[11px] text-slate-400 uppercase">Porzioni</span><span class="text-slate-700">${currentServings} pers.</span></div>
                <div>
                    <span class="block text-[11px] text-slate-400 uppercase">Fonte</span>
                    ${(() => {
                        const isSearch = r.source_url.includes('ricerca') || r.source_url.includes('search') || r.source_url.includes('?s=');
                        const icon = isSearch ? 'fa-magnifying-glass' : 'fa-arrow-up-right-from-square';
                        const label = isSearch ? `${esc(r.source)} (Cerca)` : esc(r.source);
                        return `<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer" title="${isSearch ? 'Cerca ricetta su ' + esc(r.source) : 'Apri ricetta originale'}" class="text-teal-600 underline hover:text-teal-800 font-bold inline-flex items-center gap-1">
                            ${label} <i class="fa-solid ${icon} text-[10px]"></i>
                        </a>`;
                    })()}
                </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="text-xs font-bold text-slate-500 mr-1">Porzioni:</span>
                    ${servingsBtns}
                </div>
                <button data-action="cook-mode" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-2">
                    <i class="fa-solid fa-mobile-screen"></i> Modalità cucina
                </button>
            </div>

            <div>
                <h4 class="font-bold text-sm text-slate-800 mb-2 flex items-center gap-2"><i class="fa-solid fa-basket-shopping text-teal-600"></i> Ingredienti</h4>
                <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">${ingredients}</ul>
            </div>

            <div>
                <h4 class="font-bold text-sm text-slate-800 mb-2 flex items-center gap-2"><i class="fa-solid fa-fire text-amber-500"></i> Preparazione</h4>
                <ol class="space-y-2">${steps}</ol>
            </div>

            <div class="bg-teal-50/70 border border-teal-200/80 p-4 rounded-2xl space-y-1">
                <span class="text-xs font-bold text-teal-800 uppercase">Valori nutrizionali (stima per porzione)</span>
                <p class="text-xs font-bold text-slate-700">${esc(n.calories)} · Proteine: ${esc(n.protein)} · Carboidrati: ${esc(n.carbs)} · Grassi: ${esc(n.fat)}</p>
                <p class="text-xs font-medium text-teal-700">${esc(n.notes)}</p>
            </div>`;
    }

    document.getElementById('recipeModalContent').innerHTML = header + body;
}

/* ==========================================================================
   TIMER DI COTTURA & MODALITÀ CUCINA
   ========================================================================== */

function formatTimer(totalSec) {
    const s = Math.max(0, totalSec);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function extractTimerMinutes(text) {
    if (!text) return null;
    const hourM = text.match(/(\d+)\s*or[ae]/i);
    if (hourM) return parseInt(hourM[1], 10) * 60;
    const minM = text.match(/(?:per\s+)?(\d+)(?:\s*-\s*\d+)?\s*(?:minuti|min\b)/i);
    if (minM) return parseInt(minM[1], 10);
    return null;
}

function playTimerAlarm() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99, 1046.50];
        freqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.16);
            gain.gain.setValueAtTime(0.25, now + idx * 0.16);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.45);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.16);
            osc.stop(now + idx * 0.16 + 0.5);
        });
        if ('vibrate' in navigator) navigator.vibrate([300, 150, 300, 150, 500]);
    } catch (e) {
        console.warn('Audio feedback error:', e);
    }
}

function stopCookTimer() {
    if (cookTimer.intervalId) {
        clearInterval(cookTimer.intervalId);
        cookTimer.intervalId = null;
    }
    cookTimer.isRunning = false;
}

function startCookTimer() {
    if (cookTimer.remainingSeconds <= 0) return;
    stopCookTimer();
    cookTimer.isRunning = true;
    cookTimer.alarmTriggered = false;
    cookTimer.intervalId = setInterval(() => {
        if (cookTimer.remainingSeconds > 0) {
            cookTimer.remainingSeconds--;
            renderRecipeBody();
        } else {
            stopCookTimer();
            cookTimer.alarmTriggered = true;
            playTimerAlarm();
            renderRecipeBody();
        }
    }, 1000);
    renderRecipeBody();
}

function resetCookTimer() {
    stopCookTimer();
    cookTimer.remainingSeconds = cookTimer.totalSeconds;
    cookTimer.alarmTriggered = false;
    renderRecipeBody();
}

function setCookTimerMinutes(m) {
    stopCookTimer();
    cookTimer.totalSeconds = m * 60;
    cookTimer.remainingSeconds = m * 60;
    cookTimer.alarmTriggered = false;
    startCookTimer();
}

function addCookTimerMinutes(m) {
    cookTimer.totalSeconds += m * 60;
    cookTimer.remainingSeconds += m * 60;
    cookTimer.alarmTriggered = false;
    if (!cookTimer.isRunning) startCookTimer();
    else renderRecipeBody();
}

function cookModeHtml(r) {
    const total = r.steps.length;
    const currentStepText = r.steps[cookStep] || '';
    const last = cookStep >= total - 1;
    const percent = Math.round(((cookStep + 1) / total) * 100);
    const detectedMin = extractTimerMinutes(currentStepText);
    const factor = currentServings / (r.servings || 4);

    const stepDots = r.steps.map((_, i) => {
        const isCurrent = i === cookStep;
        const isDone = i < cookStep;
        let cls = 'bg-slate-100 text-slate-500 hover:bg-slate-200';
        if (isCurrent) cls = 'bg-teal-500 text-white shadow-sm ring-2 ring-teal-300';
        else if (isDone) cls = 'bg-teal-100 text-teal-800 font-bold';
        return `<button type="button" data-action="cook-step-jump" data-step="${i}"
            class="w-7 h-7 rounded-xl text-xs font-bold transition flex items-center justify-center ${cls}"
            title="Passo ${i + 1}">
            ${i + 1}
        </button>`;
    }).join('');

    return `
        <div class="space-y-5 py-2">
            <!-- Barra di avanzamento passi -->
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-bold">
                    <span class="text-teal-700 uppercase tracking-wider">Passo ${cookStep + 1} di ${total}</span>
                    <span class="text-slate-500">${percent}% completato</span>
                </div>
                <div class="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div class="bg-teal-500 h-2.5 rounded-full transition-all duration-300" style="width: ${percent}%"></div>
                </div>
                <div class="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                    ${stepDots}
                </div>
            </div>

            <!-- Testo del passo grande e leggibile -->
            <div class="min-h-[140px] flex items-center justify-center bg-slate-50/70 p-5 rounded-2xl border border-slate-200/80">
                <p class="text-lg sm:text-xl leading-relaxed font-semibold text-slate-800 text-center">${esc(currentStepText)}</p>
            </div>

            <!-- Widget Timer di cottura -->
            <div class="bg-gradient-to-br from-slate-50 to-amber-50/40 p-4 rounded-2xl border border-slate-200/90 space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <i class="fa-solid fa-stopwatch text-teal-600"></i> Timer di cottura
                    </span>
                    ${cookTimer.alarmTriggered ? '<span class="text-xs font-bold text-rose-600 bg-rose-100 px-2.5 py-0.5 rounded-full animate-bounce"><i class="fa-solid fa-bell"></i> TEMPO SCADUTO!</span>' : ''}
                </div>

                <div class="flex items-center justify-between gap-3">
                    <div class="text-3xl sm:text-4xl font-extrabold tracking-wider font-mono ${cookTimer.alarmTriggered ? 'text-rose-600 animate-pulse' : (cookTimer.isRunning ? 'text-teal-600' : 'text-slate-700')}">
                        ${formatTimer(cookTimer.remainingSeconds)}
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" data-action="timer-toggle"
                            class="px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm ${cookTimer.isRunning ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-teal-500 hover:bg-teal-600 text-white'}">
                            <i class="fa-solid ${cookTimer.isRunning ? 'fa-pause' : 'fa-play'}"></i> ${cookTimer.isRunning ? 'Pausa' : 'Avvia'}
                        </button>
                        <button type="button" data-action="timer-reset"
                            class="p-2 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 transition"
                            title="Azzera timer" aria-label="Azzera timer">
                            <i class="fa-solid fa-rotate-left"></i>
                        </button>
                    </div>
                </div>

                <div class="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/60">
                    ${detectedMin ? `
                    <button type="button" data-action="timer-preset" data-minutes="${detectedMin}"
                        class="px-2.5 py-1 bg-teal-50 hover:bg-teal-100 text-teal-800 rounded-lg text-xs font-bold border border-teal-200 transition flex items-center gap-1">
                        <i class="fa-regular fa-clock"></i> Imposta ${detectedMin} min del passo
                    </button>` : ''}
                    <button type="button" data-action="timer-add" data-minutes="1" class="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition">+1 min</button>
                    <button type="button" data-action="timer-add" data-minutes="5" class="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition">+5 min</button>
                    <button type="button" data-action="timer-add" data-minutes="10" class="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-bold border border-slate-200 transition">+10 min</button>
                </div>
            </div>

            <!-- Controlla dosi ingredienti durante la cottura -->
            <div class="border border-slate-200/80 rounded-2xl p-3 bg-white">
                <button type="button" data-action="toggle-cook-ingredients" class="w-full flex items-center justify-between text-xs font-bold text-slate-700 py-1">
                    <span class="flex items-center gap-1.5"><i class="fa-solid fa-basket-shopping text-teal-600"></i> Dosi ingredienti (${r.ingredients.length})</span>
                    <i class="fa-solid fa-chevron-${showCookIngredients ? 'up' : 'down'} text-slate-400"></i>
                </button>
                ${showCookIngredients ? `
                    <ul class="mt-2.5 pt-2.5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs text-slate-700">
                        ${r.ingredients.map(i => `<li class="p-1.5 bg-slate-50 rounded-lg flex items-center gap-1.5"><i class="fa-solid fa-check text-teal-500 text-[10px]"></i> ${esc(scaleIngredient(i, factor))}</li>`).join('')}
                    </ul>` : ''}
            </div>

            <!-- Pulsanti navigazione passi -->
            <div class="flex items-center justify-between gap-3 pt-2">
                <button data-action="cook-prev" ${cookStep === 0 ? 'disabled' : ''}
                    class="flex-1 py-3 rounded-xl text-sm font-bold border border-slate-200 bg-white text-slate-700 disabled:opacity-40 hover:bg-slate-50 transition">
                    <i class="fa-solid fa-arrow-left mr-1"></i> Indietro
                </button>
                <button data-action="cook-next" ${last ? 'disabled' : ''}
                    class="flex-1 py-3 rounded-xl text-sm font-bold bg-teal-500 hover:bg-teal-600 text-white disabled:opacity-40 transition shadow-sm">
                    ${last ? 'Ultimo passo' : 'Avanti <i class="fa-solid fa-arrow-right ml-1"></i>'}
                </button>
            </div>

            <button data-action="cook-exit" class="w-full text-xs font-bold text-slate-500 hover:text-slate-800 py-2">
                Esci dalla modalità cucina
            </button>
        </div>`;
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* il dispositivo non supporta il blocco dello schermo */ }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
    }
}

/* ==========================================================================
   RICETTARIO
   ========================================================================== */

function chips(container, items, active, action) {
    container.innerHTML = items.map(([value, label]) => `
        <button data-action="${action}" data-value="${esc(value)}" class="chip ${active === value ? 'is-active' : ''}" aria-pressed="${active === value}">${label}</button>
    `).join('');
}

function renderCookbook() {
    chips(document.getElementById('cookbookCats'), CATEGORIES, cookFilter.cat, 'cookbook-cat');
    chips(document.getElementById('cookbookTags'), TAGS, cookFilter.tag, 'cookbook-tag');

    const q = document.getElementById('cookbookSearch').value.toLowerCase().trim();
    const list = recipesData.filter(r =>
        (cookFilter.cat === 'ALL' || r.category === cookFilter.cat) &&
        (cookFilter.tag === 'ALL' || getTags(r).includes(cookFilter.tag)) &&
        (!q ||
            r.title.toLowerCase().includes(q) ||
            r.ingredients.some(i => i.toLowerCase().includes(q)) ||
            r.steps.some(s => s.toLowerCase().includes(q)) ||
            (r.nutrition && r.nutrition.notes && r.nutrition.notes.toLowerCase().includes(q)) ||
            (r.source && r.source.toLowerCase().includes(q))
        )
    );

    document.getElementById('cookbookCount').textContent = list.length;
    const listEl = document.getElementById('cookbookList');

    if (!list.length) {
        listEl.innerHTML = '<p class="text-sm text-slate-500 font-semibold md:col-span-2 py-6 text-center">Nessuna ricetta corrisponde ai filtri.</p>';
        return;
    }

    listEl.innerHTML = list.map(r => `
        <article class="bg-slate-50/50 rounded-2xl border border-slate-200/80 p-4 flex flex-col justify-between gap-3">
            <div>
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[11px] font-bold uppercase bg-teal-50 text-teal-700 px-2.5 py-0.5 rounded-full border border-teal-200/70">${esc(r.category)}</span>
                    <span class="text-[11px] font-semibold text-slate-500"><i class="fa-regular fa-clock mr-1"></i>${esc(r.prep_time)} + ${esc(r.cook_time)}</span>
                </div>
                <h4 class="font-bold text-base text-slate-800 mt-2">${esc(r.title)}</h4>
                <p class="text-xs font-bold text-teal-700 mt-1">${esc(r.nutrition.calories)} · ${esc(r.nutrition.protein)} proteine</p>
                <p class="text-[11px] text-slate-500 mt-1">${esc(r.nutrition.notes)}</p>
                <p class="text-[11px] text-slate-600 mt-2 pt-2 border-t border-slate-200/60"><strong>Ingredienti:</strong> ${esc(r.ingredients.join(', '))}</p>
            </div>
            <div class="flex items-center justify-between gap-2 pt-1">
                <button data-action="open-recipe" data-id="${r.id}" class="px-3.5 py-1.5 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-xl text-xs transition">
                    Vedi preparazione
                </button>
                ${(() => {
                    const isSearch = r.source_url.includes('ricerca') || r.source_url.includes('search') || r.source_url.includes('?s=');
                    const icon = isSearch ? 'fa-magnifying-glass' : 'fa-arrow-up-right-from-square';
                    const label = isSearch ? `${esc(r.source)} (Cerca)` : esc(r.source);
                    return `<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer" title="${isSearch ? 'Cerca ricetta su ' + esc(r.source) : 'Apri ricetta originale'}" class="text-xs font-bold text-teal-600 hover:underline flex items-center gap-1">
                        ${label} <i class="fa-solid ${icon} text-[10px]"></i>
                    </a>`;
                })()}
            </div>
        </article>`).join('');
}

/* ==========================================================================
   DISPENSA
   ========================================================================== */

function renderPantry() {
    const list = document.getElementById('pantryItemsList');
    if (!pantry.length) {
        list.innerHTML = '<p class="text-xs text-slate-400 font-semibold py-2">La dispensa è vuota.</p>';
        return;
    }
    list.innerHTML = pantry.map((item, idx) => `
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200/70 text-xs font-semibold">
            <span class="text-slate-700">${esc(item)}</span>
            <button data-action="remove-pantry" data-idx="${idx}" class="text-slate-400 hover:text-rose-500 transition" aria-label="Rimuovi ${esc(item)}">
                <i class="fa-solid fa-trash-can text-sm"></i>
            </button>
        </div>`).join('');
}

function addPantryItem() {
    const input = document.getElementById('newPantryItem');
    const val = input.value.trim();
    if (!val) return;
    pantry.push(val);
    store.set('cianci_pantry', pantry);
    input.value = '';
    renderPantry();
}

function removePantryItem(idx) {
    pantry.splice(idx, 1);
    store.set('cianci_pantry', pantry);
    renderPantry();
}

/* ==========================================================================
   LISTA DELLA SPESA
   ========================================================================== */

function openShopping() {
    shoppingWeek = currentWeeks()[activeWeekIndex];
    ensureWeekPlan(shoppingWeek.id);
    renderShopping();
    openModal('shoppingModal');
}

function renderShopping() {
    const week = shoppingWeek;
    const items = buildShopping(week);
    const checks = checkedShopping[week.id] || {};

    document.getElementById('shoppingModalTitle').innerHTML =
        `<i class="fa-solid fa-cart-shopping text-teal-600 mr-2"></i>Lista spesa · Settimana ${week.id}`;
    document.getElementById('shoppingModalSubtitle').textContent = `Periodo: ${week.label}`;

    const listEl = document.getElementById('shoppingItemsList');
    const counter = document.getElementById('shoppingCounter');

    if (!items.length) {
        counter.textContent = '';
        listEl.innerHTML = '<p class="text-xs text-slate-400 py-4">Nessun ingrediente per questa settimana.</p>';
        return;
    }

    const toBuy = items.filter(it => !checks[it.key] && !isInPantry(it.key)).length;
    counter.textContent = `${toBuy} da acquistare su ${items.length}`;

    listEl.innerHTML = items.map(it => {
        const checked = !!checks[it.key];
        const inPantry = isInPantry(it.key);
        let badge;
        if (checked) {
            badge = '<span class="text-[11px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full border border-emerald-200 font-bold shrink-0 inline-flex items-center gap-1"><i class="fa-solid fa-check"></i> Acquistato</span>';
        } else if (inPantry) {
            badge = '<span class="text-[11px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full border border-slate-200 font-bold shrink-0">In dispensa</span>';
        } else {
            badge = '<span class="text-[11px] bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-200 font-bold shrink-0">Da acquistare</span>';
        }

        return `
            <div class="py-2.5 flex items-center justify-between gap-2 text-xs font-semibold">
                <label class="flex items-center gap-2.5 cursor-pointer flex-1 ${checked ? 'line-through text-slate-400' : 'text-slate-700'}">
                    <input type="checkbox" data-key="${encodeURIComponent(it.key)}" ${checked ? 'checked' : ''}
                        class="w-4 h-4 rounded text-teal-600 border-slate-300 focus:ring-teal-500">
                    <span>${esc(shoppingText(it))}</span>
                </label>
                ${badge}
            </div>`;
    }).join('');
}

function copyShopping(button) {
    const items = buildShopping(shoppingWeek);
    const checks = checkedShopping[shoppingWeek.id] || {};
    const lines = items
        .filter(it => !checks[it.key] && !isInPantry(it.key))
        .map(it => `- ${shoppingText(it)}`);
    const text = `Spesa settimana ${shoppingWeek.id}\n${lines.join('\n')}`;

    const done = () => {
        const original = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-check"></i> Copiata';
        setTimeout(() => { button.innerHTML = original; }, 1500);
    };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(done).catch(() => {});
    }
}

function shareShopping() {
    const items = buildShopping(shoppingWeek);
    const checks = checkedShopping[shoppingWeek.id] || {};
    const lines = items
        .filter(it => !checks[it.key] && !isInPantry(it.key))
        .map(it => `- ${shoppingText(it)}`);
    const text = `🛒 Spesa settimana ${shoppingWeek.id} (Cianci's Menù)\n${lines.join('\n')}`;

    if (navigator.share) {
        navigator.share({ title: `Spesa Sett. ${shoppingWeek.id}`, text }).catch(() => {});
    } else {
        // Fallback: apertura WhatsApp Web
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener');
    }
}

/* ==========================================================================
   MODALI
   ========================================================================== */

function openModal(id) {
    const m = document.getElementById(id);
    m.classList.remove('hidden');
    m.classList.add('flex');
}

function closeModal(id) {
    const m = document.getElementById(id);
    m.classList.add('hidden');
    m.classList.remove('flex');
    if (id === 'recipeModal') {
        cookMode = false;
        stopCookTimer();
        releaseWakeLock();
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(m => closeModal(m.id));
}

/* ==========================================================================
   SESSIONE E CARICAMENTO
   ========================================================================== */

async function hashPassword(pass) {
    if (window.crypto && crypto.subtle) {
        const msgBuffer = new TextEncoder().encode(pass);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return [...new Uint8Array(hashBuffer)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
    return null;
}

async function handleLogin(e) {
    e.preventDefault();
    const user = document.getElementById('usernameInput').value.trim();
    const pass = document.getElementById('passwordInput').value.trim();
    const found = VALID_USERS.find(u => u.toLowerCase() === user.toLowerCase());
    const errorEl = document.getElementById('loginError');

    const hash = await hashPassword(pass);
    if (found && (hash === PASSWORD_HASH || (!hash && pass === '7264'))) {
        errorEl.classList.add('hidden');
        store.set('cianci_user', found);
        showApp(found);
    } else {
        errorEl.classList.remove('hidden');
    }
}

function handleLogout() {
    store.remove('cianci_user');
    location.reload();
}

function showApp(user) {
    currentUser = user;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appWrapper').classList.remove('hidden');
    document.getElementById('bottomNav').classList.remove('hidden');
    document.getElementById('bottomNav').classList.add('md:hidden');
    document.getElementById('welcomeUserText').textContent = `Bentornato/a, ${user}`;
    initApp();
}

async function initApp() {
    try {
        const res = await fetch('recipes.json', { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        recipesData = await res.json();
    } catch (err) {
        if (typeof window !== 'undefined' && window.RECIPES_DATA && window.RECIPES_DATA.length) {
            console.warn('Fetch di recipes.json non riuscito (es. protocollo file://), uso fallback locale recipes-data.js:', err);
            recipesData = window.RECIPES_DATA;
        } else {
            console.error('Impossibile caricare recipes.json:', err);
            document.getElementById('weekContent').innerHTML = `
                <div class="bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl p-5 text-sm font-semibold">
                    Non riesco a caricare recipes.json. Verifica che il file sia nella stessa cartella di index.html.
                </div>`;
            return;
        }
    }
    document.getElementById('cookbookCount').textContent = recipesData.length;
    renderApp();
}

/* ==========================================================================
   EVENTI
   ========================================================================== */

function handleAction(el, e) {
    const action = el.dataset.action;

    switch (action) {
        case 'cookbook':
            renderCookbook();
            openModal('cookbookModal');
            break;
        case 'pantry':
            renderPantry();
            openModal('pantryModal');
            break;
        case 'shopping':
            openShopping();
            break;
        case 'home':
            closeAllModals();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            break;
        case 'close':
            closeModal(el.dataset.modal);
            break;
        case 'week':
            activeWeekIndex = Number(el.dataset.idx);
            renderApp();
            break;
        case 'open-recipe':
            closeModal('cookbookModal');
            openRecipe(Number(el.dataset.id));
            break;
        case 'swap':
            e.stopPropagation();
            swapMeal(Number(el.dataset.week), Number(el.dataset.day), el.dataset.meal);
            break;
        case 'toggle-lock':
            e.stopPropagation();
            toggleLock(Number(el.dataset.week), Number(el.dataset.day), el.dataset.meal);
            break;
        case 'regen':
            regenerateWeek(Number(el.dataset.week));
            break;
        case 'servings':
            currentServings = Number(el.dataset.value);
            renderRecipeBody();
            break;
        case 'servings-custom': {
            const inp = document.getElementById('customServings');
            const v = parseInt(inp?.value, 10);
            if (v >= 1 && v <= 20) { currentServings = v; renderRecipeBody(); }
            break;
        }
        case 'cook-mode':
            cookMode = true;
            cookStep = 0;
            showCookIngredients = false;
            renderRecipeBody();
            requestWakeLock();
            break;
        case 'cook-exit':
            cookMode = false;
            stopCookTimer();
            releaseWakeLock();
            renderRecipeBody();
            break;
        case 'cook-prev':
            cookStep = Math.max(0, cookStep - 1);
            renderRecipeBody();
            break;
        case 'cook-next': {
            const r = getRecipe(currentRecipeId);
            if (r) cookStep = Math.min(r.steps.length - 1, cookStep + 1);
            renderRecipeBody();
            break;
        }
        case 'cook-step-jump':
            cookStep = Number(el.dataset.step);
            renderRecipeBody();
            break;
        case 'timer-toggle':
            if (cookTimer.isRunning) stopCookTimer();
            else {
                if (cookTimer.remainingSeconds <= 0 && cookTimer.totalSeconds > 0) {
                    cookTimer.remainingSeconds = cookTimer.totalSeconds;
                } else if (cookTimer.remainingSeconds <= 0) {
                    // Default to 10 minutes if no timer set
                    cookTimer.totalSeconds = 10 * 60;
                    cookTimer.remainingSeconds = 10 * 60;
                }
                startCookTimer();
            }
            renderRecipeBody();
            break;
        case 'timer-reset':
            resetCookTimer();
            break;
        case 'timer-preset':
            setCookTimerMinutes(Number(el.dataset.minutes));
            break;
        case 'timer-add':
            addCookTimerMinutes(Number(el.dataset.minutes));
            break;
        case 'toggle-cook-ingredients':
            showCookIngredients = !showCookIngredients;
            renderRecipeBody();
            break;
        case 'cookbook-cat':
            cookFilter.cat = el.dataset.value;
            renderCookbook();
            break;
        case 'cookbook-tag':
            cookFilter.tag = el.dataset.value;
            renderCookbook();
            break;
        case 'add-pantry':
            addPantryItem();
            break;
        case 'remove-pantry':
            removePantryItem(Number(el.dataset.idx));
            break;
        case 'copy-shopping':
            copyShopping(el);
            break;
        case 'share-shopping':
            shareShopping();
            break;
        case 'toggle-password': {
            const input = document.getElementById('passwordInput');
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            el.setAttribute('aria-pressed', String(show));
            el.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
            el.querySelector('i').className = show ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
            break;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Pulizia della vecchia chiave con la data di riferimento
    store.remove('cianci_refdate');

    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Azioni delegate: un solo gestore per tutti i pulsanti
    document.addEventListener('click', e => {
        const el = e.target.closest('[data-action]');
        if (el) handleAction(el, e);
    });

    // Tastiera: Invio attiva le card, Esc chiude i modali
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeAllModals();
            return;
        }
        if (e.key === 'Enter' && e.target.matches('[role="button"][data-action]')) {
            e.target.click();
        }
    });

    // Chiudi cliccando sullo sfondo del modale
    document.querySelectorAll('.modal').forEach(m => {
        m.addEventListener('click', e => {
            if (e.target === m) closeModal(m.id);
        });
    });

    document.getElementById('cookbookSearch').addEventListener('input', renderCookbook);

    document.getElementById('newPantryItem').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPantryItem();
        }
    });

    document.getElementById('shoppingItemsList').addEventListener('change', e => {
        const cb = e.target.closest('input[data-key]');
        if (!cb) return;
        const key = decodeURIComponent(cb.dataset.key);
        const id = shoppingWeek.id;
        checkedShopping[id] = checkedShopping[id] || {};
        checkedShopping[id][key] = cb.checked;
        store.set('cianci_checked_shopping', checkedShopping);
        renderShopping();
    });

    // Sessione già attiva
    const saved = store.get('cianci_user', null);
    if (saved && VALID_USERS.includes(saved)) {
        showApp(saved);
    }

    // Registrazione Service Worker (PWA)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW:', err));
    }
});
