// === Estados e Elementos ===
const elements = {
    // Abas
    tabs: document.querySelectorAll('.tab-btn'),
    panes: document.querySelectorAll('.tab-pane'),

    // Perfil
    statusBox: document.getElementById('status-container'),
    statusText: document.getElementById('status-text'),
    profileCard: document.getElementById('profile-card'),
    profileCover: document.getElementById('profile-cover'),
    profileIcon: document.getElementById('profile-icon'),
    summonerName: document.getElementById('summoner-name'),
    summonerLevel: document.getElementById('summoner-level'),
    walletText: document.getElementById('wallet-be'),

    // Skins (Novo Grid)
    champSearch: document.getElementById('champ-search'),
    championGrid: document.getElementById('champion-grid'),
    skinGrid: document.getElementById('skin-grid'),
    skinActions: document.getElementById('skin-actions'),
    btnBackChamps: document.getElementById('btn-back-champs'),
    btnSetSkin: document.getElementById('btn-set-skin'),

    // Ícones
    iconSearch: document.getElementById('icon-search'),
    btnSearchIcon: document.getElementById('btn-search-icon'),
    iconGrid: document.getElementById('icon-grid'),

    // Elo/Status
    eloSelect: document.getElementById('elo-select'),
    btnSetElo: document.getElementById('btn-set-elo'),
    statusInput: document.getElementById('status-input'),
    btnChangeStatus: document.getElementById('btn-change-status')
};

let championData = [];
let iconsDataCache = [];
let selectedSkinId = null;
let currentLolVersion = "15.1.1";
let ownedIconsIds = new Set();

// === Helper de Log na UI ===
function logUI(msg, isError = false) {
    console.log(msg);
    if (elements.statusText) {
        elements.statusText.textContent = msg;
        elements.statusText.style.color = isError ? '#ff4444' : '#ffffff';
    }
}

// === Inicialização de Abas ===
if (elements.tabs) {
    elements.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            elements.tabs.forEach(t => t.classList.remove('active'));
            elements.panes.forEach(p => p.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.add('active');

            // Auto-load icons if entering icon tab
            if (targetId === 'tab-icons' && iconsDataCache.length === 0) {
                searchIcons("");
            }
        });
    });
}

// === Carregamento Inicial Global ===
document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Carregado.");

    // 1. Obter versão mais recente do LoL
    try {
        const versions = await window.api.externalRequest('https://ddragon.leagueoflegends.com/api/versions.json');
        if (versions && versions.length > 0) {
            currentLolVersion = versions[0];
            console.log(`Versão detectada: ${currentLolVersion}`);
        }
    } catch (e) {
        console.warn("Falha ao obter versão DDragon, usando fallback:", currentLolVersion);
    }

    // 2. Carregar Campeões
    loadChampionData();
});

// === Inicialização LCU ===
window.api.onConnectionStatus((isConnected) => {
    console.log(`Status de Conexão LCU: ${isConnected}`);
    if (isConnected) {
        setConnected(true);
        fetchSummonerData();
        updateOwnedIcons();
    } else {
        setConnected(false);
    }
});

function setConnected(isOnline) {
    if (elements.statusBox) {
        elements.statusBox.className = isOnline ? 'status-box connected' : 'status-box disconnected';
        elements.statusText.textContent = isOnline ? 'Conectado ao League Client' : 'Aguardando League Client...';
        elements.statusText.style.color = isOnline ? '#4cd964' : '#ffffff';
    }
    if (elements.profileCard && isOnline) elements.profileCard.classList.remove('hidden');
}

// === 1. Dados do Invocador ===
async function fetchSummonerData() {
    logUI("Buscando dados do Invocador...");
    if (elements.summonerName) elements.summonerName.textContent = "Carregando...";

    try {
        const summoner = await window.api.request('/lol-summoner/v1/current-summoner', 'GET');
        // Validate: Must have accountId or summonerId. displayName can be empty (use gameName).
        if (!summoner || (!summoner.accountId && !summoner.summonerId)) throw new Error("Dados incompletos (ID missing)");

        const nameDisplay = summoner.displayName || `${summoner.gameName} #${summoner.tagLine}`;
        if (elements.summonerName) elements.summonerName.textContent = nameDisplay || "Invocador Desconhecido";
        if (elements.summonerLevel) elements.summonerLevel.textContent = summoner.summonerLevel;

        const iconUrl = `https://ddragon.leagueoflegends.com/cdn/${currentLolVersion}/img/profileicon/${summoner.profileIconId}.png`;
        if (elements.profileIcon) {
            elements.profileIcon.src = 'assets/loading.gif';
            proxyImage(elements.profileIcon, iconUrl);
        }

        if (elements.walletText) elements.walletText.textContent = `${summoner.xpSinceLastLevel} XP / ${summoner.xpUntilNextLevel} XP`;


        // --- Background Skin Logic ---
        try {
            const profileData = await window.api.request('/lol-summoner/v1/current-summoner/summoner-profile', 'GET');
            if (profileData && profileData.backgroundSkinId) {
                const skinId = profileData.backgroundSkinId;
                const champId = Math.floor(skinId / 1000);

                // Find Champion Alias
                const champ = championData.find(c => c.id === champId);
                if (champ) {
                    let alias = champ.alias;
                    if (!alias || alias === "null") alias = champ.name.replace(/[^a-zA-Z0-9]/g, '');

                    // Specific fix for Fiddlesticks being "Fiddlesticks" in some data but "FiddleSticks" in DDragon
                    if (alias === "Fiddlesticks") alias = "FiddleSticks";

                    const skinNum = skinId % 1000;
                    const splashUrl = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${alias}_${skinNum}.jpg`;

                    if (elements.profileCover) {
                        proxyImage(elements.profileCover, splashUrl);
                    }
                }
            }
        } catch (bgErr) {
            console.warn("Erro ao carregar background:", bgErr);
        }

        logUI("Dados do invocador carregados.");
    } catch (err) {
        console.error('Erro perfil:', err);
        logUI(`Erro perfil: ${err.message}`, true);
        if (elements.summonerName) elements.summonerName.textContent = "Erro de Leitura";

        // DEBUG: Tentar pegar o que veio
        window.api.request('/lol-summoner/v1/current-summoner', 'GET').then(raw => {
            console.log("DEBUG RAW SUMMONER:", raw);
            logUI("Debug: " + JSON.stringify(raw).substring(0, 50) + "...", true);
        }).catch(e => logUI("Falha total na req: " + e, true));
    }
}

const btnRefresh = document.getElementById('btn-refresh-profile');
if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
        fetchSummonerData();
        updateOwnedIcons();
    });
}

// === 2. Skins e Campeões ===
async function loadChampionData() {
    if (!elements.championGrid) return;
    if (championData.length > 0) return;

    elements.championGrid.innerHTML = '<p style="text-align:center; color:#888;">Atualizando dados...</p>';
    logUI("Baixando dados de campeões...");

    try {
        // Tentar DDragon Primeiro
        const ddragonUrl = `https://ddragon.leagueoflegends.com/cdn/${currentLolVersion}/data/pt_BR/champion.json`;
        const json = await window.api.externalRequest(ddragonUrl);

        if (json && json.data) {
            championData = Object.values(json.data).map(champ => ({
                id: parseInt(champ.key),
                name: champ.name,
                alias: champ.id,
                skins: []
            })).sort((a, b) => a.name.localeCompare(b.name));

            // Tentar CDragon para skins (Background fetch)
            try {
                const summary = await window.api.externalRequest('https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json');
                if (summary && Array.isArray(summary)) {
                    const summaryMap = new Map(summary.map(c => [c.id, c]));
                    championData = championData.map(c => {
                        const s = summaryMap.get(c.id);
                        if (s) {
                            return {
                                ...c,
                                skins: s.skins.map(sk => ({ id: sk.id, name: sk.name }))
                            };
                        }
                        return c;
                    });
                    console.log("Skins cruzadas com DDragon.");
                }
            } catch (e) { console.warn("CDragon failed, using basic data"); }

            renderChampionGrid(championData);
            logUI(`Campeões carregados: ${championData.length}`);
        } else {
            throw new Error("Invalid Data");
        }
    } catch (e) {
        console.error("Erro campeões:", e);
        logUI("Erro ao baixar dados de campeões", true);
        elements.championGrid.innerHTML = '<p style="text-align:center; color:red;">Erro de Rede.</p>';
    }
}

function renderChampionGrid(list) {
    if (!elements.championGrid) return;
    elements.championGrid.innerHTML = '';

    elements.championGrid.classList.remove('hidden');
    elements.skinGrid.classList.add('hidden');
    elements.skinActions.classList.add('hidden');
    elements.btnBackChamps.classList.add('hidden');
    if (elements.champSearch) elements.champSearch.classList.remove('hidden');

    list.forEach(champ => {
        const div = document.createElement('div');
        div.className = 'champion-item';
        div.title = champ.name;

        const img = document.createElement('img');
        let cleanAlias = champ.alias;
        if (!cleanAlias || cleanAlias === "null") cleanAlias = champ.name.replace(/[^a-zA-Z0-9]/g, '');
        const iconUrl = `https://ddragon.leagueoflegends.com/cdn/${currentLolVersion}/img/champion/${cleanAlias}.png`;
        proxyImage(img, iconUrl);

        div.onclick = () => showSkinsForChampion(champ);
        div.appendChild(img);
        elements.championGrid.appendChild(div);
    });
}

if (elements.champSearch) {
    elements.champSearch.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        renderChampionGrid(championData.filter(c => c.name.toLowerCase().includes(term)));
    });
}

// === 2. Skins (Lazy Loading) ===
async function showSkinsForChampion(champ) {
    if (!elements.skinGrid) return;

    elements.championGrid.classList.add('hidden');
    if (elements.champSearch) elements.champSearch.classList.add('hidden');
    elements.skinGrid.classList.remove('hidden');
    elements.skinActions.classList.remove('hidden');
    elements.btnBackChamps.classList.remove('hidden');

    elements.skinGrid.innerHTML = '<p>Carregando skins...</p>';

    // Alias cleaning
    let cleanAlias = champ.alias;
    if (!cleanAlias || cleanAlias === "null") cleanAlias = champ.name.replace(/[^a-zA-Z0-9]/g, '');

    // CHECK IF SKINS EXIST. IF NOT, FETCH.
    let skinsList = champ.skins;
    if (!skinsList || skinsList.length === 0) {
        logUI(`Buscando detalhes de ${cleanAlias}...`);
        try {
            // Fetch champion details from DDragon
            const url = `https://ddragon.leagueoflegends.com/cdn/${currentLolVersion}/data/pt_BR/champion/${cleanAlias}.json`;
            const data = await window.api.externalRequest(url);

            if (data && data.data && data.data[cleanAlias]) {
                skinsList = data.data[cleanAlias].skins;
                // Cache for next time
                champ.skins = skinsList;
            } else {
                throw new Error("Dados detalhados não encontrados");
            }
        } catch (e) {
            console.error("Erro Lazy Load:", e);
            elements.skinGrid.innerHTML = `<p style="color:red">Erro ao carregar skins: ${e.message}</p>`;
            return;
        }
    }

    elements.skinGrid.innerHTML = '';

    // Render Skins
    skinsList.forEach(skin => {
        const img = document.createElement('img');
        img.className = 'skin-item';
        img.title = skin.name;

        // DDragon skin loading images
        // num usually is the ID % 1000, but in DDragon check 'num' property
        const skinNum = skin.num;
        const skinUrl = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${cleanAlias}_${skinNum}.jpg`;

        img.style.cursor = 'pointer';
        img.style.width = '100px';
        img.style.height = '180px';
        img.style.objectFit = 'cover';
        img.style.margin = '5px';
        img.style.borderRadius = '8px';
        img.style.border = '2px solid #333';
        img.style.transition = 'transform 0.2s';

        proxyImage(img, skinUrl);

        img.onclick = () => {
            document.querySelectorAll('.skin-item').forEach(i => {
                i.style.border = '2px solid #333';
                i.style.transform = 'scale(1)';
            });
            img.style.border = '2px solid #C8AA6E';
            img.style.transform = 'scale(1.05)';

            selectedSkinId = skin.id;
            if (elements.btnSetSkin) {
                elements.btnSetSkin.disabled = false;
                elements.btnSetSkin.textContent = `Definir: ${skin.name}`;
            }
        };
        elements.skinGrid.appendChild(img);
    });
}

if (elements.btnBackChamps) {
    elements.btnBackChamps.addEventListener('click', () => renderChampionGrid(championData));
}

if (elements.btnSetSkin) {
    elements.btnSetSkin.addEventListener('click', async () => {
        if (!selectedSkinId) return;
        try {
            await window.api.request('/lol-summoner/v1/current-summoner/summoner-profile', 'POST', {
                key: "backgroundSkinId",
                value: selectedSkinId
            });
            alert('Fundo atualizado!');
        } catch (e) {
            alert('Erro: ' + e.message);
        }
    });
}

// === 3. Ícones ===
async function updateOwnedIcons() {
    try {
        const icons = await window.api.request('/lol-collections/v1/inventories/local/summoner-icons', 'GET');
        if (Array.isArray(icons)) ownedIconsIds = new Set(icons.map(i => i.summonerIconId));
    } catch (e) { }
}

async function searchIcons(query) {
    if (!elements.iconGrid) return;
    elements.iconGrid.innerHTML = '<p>Buscando...</p>';
    logUI("Buscando ícones...");

    logUI(`Versão LoL: ${currentLolVersion}`);
    if (iconsDataCache.length === 0) {
        try {
            // Priority 1: CommunityDragon (Has Titles/Descriptions)
            const cdUrl = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-icons.json';
            logUI(`Tentando CDragon (Melhores Nomes)...`);
            let cdData = await window.api.externalRequest(cdUrl);
            if (typeof cdData === 'string') {
                try { cdData = JSON.parse(cdData); } catch (e) { }
            }

            if (cdData && Array.isArray(cdData)) {
                iconsDataCache = cdData;
                logUI(`CDragon OK! ${iconsDataCache.length} ícones.`);
            } else {
                throw new Error("CDragon inválido");
            }
        } catch (e) {
            console.warn("CDragon Falhou:", e);
            logUI("CDragon falhou. Usando DDragon (Sem nomes)...");

            // Priority 2: DDragon (IDs only)
            try {
                const ddUrl = `https://ddragon.leagueoflegends.com/cdn/${currentLolVersion}/data/pt_BR/profileicon.json`;
                let ddJson = await window.api.externalRequest(ddUrl);
                if (typeof ddJson === 'string') {
                    try { ddJson = JSON.parse(ddJson); } catch (e) { }
                }

                if (ddJson && ddJson.data) {
                    iconsDataCache = Object.values(ddJson.data).map(i => ({ id: i.id, title: `Ícone ${i.id}` }));
                    logUI(`DDragon OK! ${iconsDataCache.length} ícones.`);
                } else {
                    throw new Error("DDragon sem dados");
                }
            } catch (e2) {
                console.error("All Sources Failed:", e2);
                elements.iconGrid.innerHTML = `<p style="color:red">Erro ao baixar ícones.</p>`;
                return;
            }
        }
    }

    if (iconsDataCache.length === 0) {
        elements.iconGrid.innerHTML = '<p style="color:red">Falha ao obter lista de ícones.</p>';
        return;
    }

    const term = query ? query.toString().toLowerCase() : "";

    // Filtro mais permissivo
    const filtered = iconsDataCache.filter(i => {
        const idStr = String(i.id);
        const titleStr = i.title ? i.title.toLowerCase() : "";
        return idStr.includes(term) || titleStr.includes(term);
    });



    logUI(`Cache: ${iconsDataCache.length} | Filtro: ${filtered.length}`);
    if (iconsDataCache.length > 0) {
        logUI(`Item 0: ${JSON.stringify(iconsDataCache[0])}`);
    }

    elements.iconGrid.innerHTML = '';
    const subset = filtered.slice(0, 100);

    if (subset.length === 0) {
        const debugInfo = `
            Term: "${term}" (${typeof term}) <br>
            Cache Len: ${iconsDataCache.length} <br>
            Item 0: ${JSON.stringify(iconsDataCache[0])} <br>
            Typeof Item 0: ${typeof iconsDataCache[0]}
        `;
        logUI("Filtro 0. Debug: " + debugInfo.replace(/<br>/g, " | "));
        elements.iconGrid.innerHTML = `<p style="color:red; word-break:break-all;">Nada encontrado.<br><small>${debugInfo}</small></p>`;
        return;
    }

    subset.forEach(icon => {
        const isOwned = ownedIconsIds.has(icon.id);
        const div = document.createElement('div');
        div.className = `icon-item-container ${isOwned ? '' : 'locked'}`;
        div.title = isOwned ? "Adquirido" : `ID: ${icon.id}`;

        const img = document.createElement('img');
        const url = `https://ddragon.leagueoflegends.com/cdn/${currentLolVersion}/img/profileicon/${icon.id}.png`;

        proxyImage(img, url);

        div.onclick = () => {
            logUI(`Definindo ícone ${icon.id}...`);
            window.api.request('/lol-chat/v1/me', 'PUT', { icon: icon.id })
                .then(() => {
                    logUI("Ícone definido!");
                    fetchSummonerData();
                })
                .catch(err => {
                    logUI(`Erro: ${err.message}`, true);
                });
        };
        div.appendChild(img);
        elements.iconGrid.appendChild(div);
    });
    logUI(`Ícones listados: ${subset.length}`);
}

if (elements.btnSearchIcon) {
    elements.btnSearchIcon.addEventListener('click', () => searchIcons(elements.iconSearch.value));
}

// === 4. Elo & Status ===
if (elements.btnSetElo) {
    elements.btnSetElo.addEventListener('click', async () => {
        const tier = elements.eloSelect.value;
        const stats = {
            "lol": {
                "rankedLeagueTier": tier,
                "rankedLeagueDivision": "I",
                "rankedLeagueQueue": "RANKED_SOLO_5x5",
                "rankedLeaguebestLeagueDivision": "I",
                "rankedLeaguebestLeagueTier": tier,
                "rankedLeaguebestLeagueQueue": "RANKED_SOLO_5x5"
            }
        };
        await window.api.request('/lol-chat/v1/me', 'PUT', stats);
        alert('Elo definido!');
    });
}

if (elements.btnChangeStatus) {
    elements.btnChangeStatus.addEventListener('click', async () => {
        await window.api.request('/lol-chat/v1/me', 'PUT', { statusMessage: elements.statusInput.value });
        alert('Status atualizado!');
    });
}

async function proxyImage(img, url) {
    try {
        const b64 = await window.api.externalRequest(url, true);
        img.src = b64;
    } catch (e) {
        img.src = 'https://via.placeholder.com/50?text=Err';
        // Fallback visual silencioso
    }
}
