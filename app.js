const PROFILE_KEY = 'kinradar_profile_v1';
const DB_URL_KEY = 'kinradar_db_url_v1';

const defaultProfile = {
    deviceId: 'dev_' + Math.random().toString(36).slice(2, 10),
    name: 'Io',
    color: '#2563eb',
    roomCode: 'famiglia-principale',
    sharing: true,
    lat: null,
    lng: null,
    accuracy: null,
    updatedAt: null
};

let profile = JSON.parse(localStorage.getItem(PROFILE_KEY)) || defaultProfile;
let dbUrl = localStorage.getItem(DB_URL_KEY) || '';
let remoteMembers = {};
let watchId = null;

// --- MAPPA LEAFLET ---
const map = L.map('map', { zoomControl: false }).setView([41.9028, 12.4964], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap'
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);

function notify(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2800);
}

function saveProfile() {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// --- DISTANZA HAVERSINE (KM / METRI) ---
function getDistanceText(lat1, lon1, lat2, lon2) {
    if ([lat1, lon1, lat2, lon2].some(v => typeof v !== 'number')) return '';
    const R = 6371e3;
    const toRad = d => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    if (meters < 1000) return `${Math.round(meters)} m da te`;
    return `${(meters / 1000).toFixed(1)} km da te`;
}

function formatTimeAgo(ts) {
    if (!ts) return 'Mai aggiornato';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'Aggiornato ora';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} min fa`;
    const ore = Math.floor(min / 60);
    return `${ore} h fa`;
}

// --- GEOLOCALIZZAZIONE GPS ---
function startGPS() {
    if (!('geolocation' in navigator)) {
        document.getElementById('gps-status').textContent = 'GPS non supportato';
        return;
    }

    if (watchId !== null) navigator.geolocation.clearWatch(watchId);

    if (!profile.sharing) {
        document.getElementById('gps-status').textContent = 'Condivisione in pausa';
        document.getElementById('live-dot').classList.remove('active');
        return;
    }

    document.getElementById('gps-status').textContent = 'Ricerca GPS...';

    watchId = navigator.geolocation.watchPosition(
        pos => {
            profile.lat = pos.coords.latitude;
            profile.lng = pos.coords.longitude;
            profile.accuracy = Math.round(pos.coords.accuracy);
            profile.updatedAt = Date.now();
            saveProfile();

            document.getElementById('gps-status').textContent = `GPS attivo (±${profile.accuracy}m)`;
            document.getElementById('live-dot').classList.add('active');

            if (!map._centeredOnce) {
                map.setView([profile.lat, profile.lng], 15);
                map._centeredOnce = true;
            }

            pushMyLocation();
            renderAll();
        },
        err => {
            document.getElementById('gps-status').textContent = 'Permesso GPS negato';
            document.getElementById('live-dot').classList.remove('active');
            notify('Attiva la geolocalizzazione per condividere la posizione');
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
}

// --- SINCRONIZZAZIONE FIREBASE REALTIME DB ---
function getRoomEndpoint() {
    if (!dbUrl) return '';
    const cleanBase = dbUrl.replace(/\/$/, '');
    const safeRoom = encodeURIComponent(profile.roomCode || 'famiglia-principale');
    return `${cleanBase}/rooms/${safeRoom}/members/${profile.deviceId}.json`;
}

function getRoomListEndpoint() {
    if (!dbUrl) return '';
    const cleanBase = dbUrl.replace(/\/$/, '');
    const safeRoom = encodeURIComponent(profile.roomCode || 'famiglia-principale');
    return `${cleanBase}/rooms/${safeRoom}/members.json`;
}

async function pushMyLocation() {
    const endpoint = getRoomEndpoint();
    if (!endpoint || !profile.sharing || profile.lat === null) return;

    try {
        await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: profile.deviceId,
                name: profile.name,
                color: profile.color,
                lat: profile.lat,
                lng: profile.lng,
                accuracy: profile.accuracy,
                updatedAt: profile.updatedAt
            })
        });
    } catch {
        // Silenzioso se rete temporaneamente assente
    }
}

async function pullRoomMembers() {
    const endpoint = getRoomListEndpoint();
    if (!endpoint) {
        remoteMembers = {};
        renderAll();
        return;
    }

    try {
        const res = await fetch(endpoint);
        const data = await res.json();
        remoteMembers = data || {};
        renderAll();
    } catch {
        // Ignora errori transitori
    }
}

// --- RENDER LISTA E PIN SULLA MAPPA ---
function renderAll() {
    document.getElementById('room-label').textContent = `Stanza: ${profile.roomCode}`;

    const allMap = { ...remoteMembers };
    if (profile.sharing && profile.lat !== null) {
        allMap[profile.deviceId] = {
            id: profile.deviceId,
            name: `${profile.name} (Tu)`,
            color: profile.color,
            lat: profile.lat,
            lng: profile.lng,
            updatedAt: profile.updatedAt,
            isMe: true
        };
    }

    const people = Object.values(allMap).filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');

    // Aggiorna marcatori
    markersLayer.clearLayers();
    people.forEach(p => {
        const icon = L.divIcon({
            className: '',
            html: `<div class="custom-pin" style="background:${p.color}"><span>${(p.name || '?')[0].toUpperCase()}</span></div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 36]
        });

        const marker = L.marker([p.lat, p.lng], { icon })
            .bindPopup(`<strong>${p.name}</strong><br>${formatTimeAgo(p.updatedAt)}`)
            .addTo(markersLayer);

        marker.on('click', () => map.setView([p.lat, p.lng], 16));
    });

    // Aggiorna bottom sheet
    const listEl = document.getElementById('members-list');
    if (!people.length) {
        listEl.innerHTML = `<p class="hint">Nessuna posizione visibile al momento. Controlla il GPS o configura l'URL del database in Impostazioni.</p>`;
        return;
    }

    listEl.innerHTML = people.map(p => {
        const dist = !p.isMe && profile.lat !== null
            ? getDistanceText(profile.lat, profile.lng, p.lat, p.lng)
            : 'Posizione attuale';
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;

        return `
            <div class="member-card" onclick="focusPerson(${p.lat}, ${p.lng})">
                <div class="member-left">
                    <div class="avatar" style="background:${p.color}">${(p.name || '?')[0].toUpperCase()}</div>
                    <div class="member-info">
                        <strong>${p.name}</strong>
                        <span>${dist} • ${formatTimeAgo(p.updatedAt)}</span>
                    </div>
                </div>
                ${!p.isMe ? `<a class="btn-nav" href="${navUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Naviga</a>` : ''}
            </div>
        `;
    }).join('');
}

window.focusPerson = (lat, lng) => {
    map.setView([lat, lng], 16);
};

// --- CONTROLLI UI ---
document.getElementById('btn-center-me').onclick = () => {
    if (profile.lat !== null) {
        map.setView([profile.lat, profile.lng], 16);
    } else {
        notify('Posizione GPS non ancora disponibile');
    }
};

const shareBtn = document.getElementById('btn-toggle-share');
function syncShareBtn() {
    shareBtn.textContent = profile.sharing ? 'Condivisione ON' : 'Condivisione OFF';
    shareBtn.classList.toggle('active', profile.sharing);
}
shareBtn.onclick = () => {
    profile.sharing = !profile.sharing;
    saveProfile();
    syncShareBtn();
    startGPS();
    renderAll();
    notify(profile.sharing ? 'Condivisione posizione attiva' : 'Condivisione posizione in pausa');
};

const modal = document.getElementById('setup-modal');
document.getElementById('btn-setup').onclick = () => {
    document.getElementById('my-name').value = profile.name;
    document.getElementById('my-color').value = profile.color;
    document.getElementById('room-code').value = profile.roomCode;
    document.getElementById('db-url').value = dbUrl;
    modal.classList.remove('hidden');
};
document.getElementById('close-setup').onclick = () => modal.classList.add('hidden');

document.getElementById('form-profile').onsubmit = e => {
    e.preventDefault();
    profile.name = document.getElementById('my-name').value.trim() || 'Membro';
    profile.color = document.getElementById('my-color').value;
    profile.roomCode = document.getElementById('room-code').value.trim().toLowerCase() || 'famiglia-principale';
    dbUrl = document.getElementById('db-url').value.trim();

    saveProfile();
    localStorage.setItem(DB_URL_KEY, dbUrl);
    modal.classList.add('hidden');
    pushMyLocation();
    pullRoomMembers();
    renderAll();
    notify('Impostazioni salvate');
};

// Avvio e polling ogni 5 secondi per vedere gli altri familiari
syncShareBtn();
startGPS();
pullRoomMembers();
setInterval(() => {
    pullRoomMembers();
    renderAll();
}, 5000);