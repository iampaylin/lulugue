const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const https = require('https');
const http = require('http');
const fs = require('fs');

// Ignorar erros de certificado auto-assinado (o cliente do LoL usa um)
const agent = new https.Agent({
    rejectUnauthorized: false
});

let mainWindow;
let lcuCredentials = null;
let manualLolPath = null;

// === AUTO UPDATER ===
const { autoUpdater } = require('electron-updater');

// Configurar logs (opcional, ajuda a debugar)
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';

// Verificar atualizações assim que o app estiver pronto
app.on('ready', () => {
    autoUpdater.checkForUpdatesAndNotify();
});

// Eventos de atualização
autoUpdater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send('update_available');
});

autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update_downloaded');
    // Instalar e reiniciar imediatamente (comportamento forçado)
    autoUpdater.quitAndInstall();
});


function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        backgroundColor: '#1e1e1e', // Cor de fundo escura para evitar flash branco
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false, // Segurança: impedir acesso direto ao Node na UI
            contextIsolation: true, // Segurança: isolar contexto
            webSecurity: false      // PERMITIR carregar imagens de URLs externas
        },
        autoHideMenuBar: true
    });

    mainWindow.loadFile('index.html');
}

// === Lógica de Conexão com o LCU ===

// Função auxiliar para extrair credenciais de uma string de comando
function parseCommandLine(cmd) {
    if (!cmd) return null;

    // Padrões regex para pegar porta e token
    const portMatch = cmd.match(/--app-port=([0-9]*)/);
    const passwordMatch = cmd.match(/--remoting-auth-token=([\w-]*)/);

    if (portMatch && passwordMatch) {
        return {
            port: portMatch[1],
            password: passwordMatch[1],
            url: `https://127.0.0.1:${portMatch[1]}`,
            auth: 'Basic ' + Buffer.from(`riot:${passwordMatch[1]}`).toString('base64'),
            protocol: 'https'
        };
    }
    return null;
}

// Estratégia 1: PowerShell (Moderno)
const getFromPowerShell = () => {
    return new Promise((resolve) => {
        const command = `Get-CimInstance Win32_Process -Filter "Name = 'LeagueClientUx.exe'" | Select-Object -ExpandProperty CommandLine`;
        exec(`powershell -Command "${command}"`, (err, stdout) => {
            if (err || !stdout.trim()) return resolve(null);
            resolve(parseCommandLine(stdout));
        });
    });
};

// Estratégia 2: WMIC (Legado/Compatível)
const getFromWMIC = () => {
    return new Promise((resolve) => {
        exec(`wmic PROCESS WHERE name='LeagueClientUx.exe' GET commandline`, (err, stdout) => {
            if (err || !stdout.trim()) return resolve(null);
            resolve(parseCommandLine(stdout));
        });
    });
};

// Estratégia 3: Lockfile (Padrão de Instalação)
// Estratégia 3: Lockfile (Padrão de Instalação + Manual)
const getFromLockfile = (customPath = null) => {
    return new Promise((resolve) => {
        let potentialArray = [
            'C:\\Riot Games\\League of Legends\\lockfile',
            'D:\\Riot Games\\League of Legends\\lockfile'
        ];

        if (customPath) {
            potentialArray = [path.join(customPath, 'lockfile')];
        }

        for (const path of potentialArray) {
            if (fs.existsSync(path)) {
                try {
                    const content = fs.readFileSync(path, 'utf8').trim();
                    const [name, pid, port, password, protocol] = content.split(':');
                    resolve({
                        port: port,
                        password: password,
                        url: `${protocol}://127.0.0.1:${port}`,
                        auth: 'Basic ' + Buffer.from(`riot:${password}`).toString('base64'),
                        protocol: protocol
                    });
                    return;
                } catch (e) {
                    console.error('Erro ao ler lockfile:', e);
                }
            }
        }
        resolve(null);
    });
};

const getLCUCredentials = async () => {
    // Tenta todas as estratégias em ordem
    let creds = await getFromPowerShell();
    if (creds) return creds;

    // console.log('PowerShell falhou, tentando WMIC...');
    creds = await getFromWMIC();
    if (creds) return creds;

    // console.log('WMIC falhou, checando pasta padrão...');
    creds = await getFromLockfile(manualLolPath);

    return creds;
};

// Monitorar a conexão constantemente
setInterval(async () => {
    const creds = await getLCUCredentials();

    if (creds && !lcuCredentials) {
        // Acabou de conectar
        lcuCredentials = creds;
        console.log('LCU Conectado:', creds.url);
        if (mainWindow) mainWindow.webContents.send('lcu-connected', true);
    } else if (!creds && lcuCredentials) {
        // Desconectou
        lcuCredentials = null;
        console.log('LCU Desconectado');
        if (mainWindow) mainWindow.webContents.send('lcu-connected', false);
    }
}, 2000); // Checa a cada 2 segundos

// === Manipuladores de IPC (Comunicação com o Frontend) ===

ipcMain.handle('lcu-request', async (event, endpoint, method = 'GET', body = null) => {
    if (!lcuCredentials) throw new Error('LCU não conectado');

    // Usar HTTPS nativo para LCU também, para padronizar e evitar deps externas se possível
    // Mas o node-fetch estava funcionando para o LCU local. Vamos manter o node-fetch SÓ AQUI se ele já estiver instalado.
    // MAS, como estamos removendo dependencias para robustez, vamos fazer um mini wrapper httprequest para o LCU tb.

    // ATENÇÃO: Para simplificar e garantir que não quebre o que já funciona (LCU), vou manter fetch se existir, 
    // mas se quisermos ser puristas, poderiamos usar o https.request.
    // Vamos usar o fetch nativo do node 18+ se disponivel ou fallback.
    // Como o user tem node-fetch instalado, vamos usar ele SÓ aqui para garantir compatibilidade com código antigo.
    const fetch = require('node-fetch');

    const options = {
        method: method,
        headers: {
            'Authorization': lcuCredentials.auth,
            'Content-Type': 'application/json'
        },
        agent: agent
    };

    if (body) options.body = JSON.stringify(body);

    try {
        const response = await fetch(`${lcuCredentials.url}${endpoint}`, options);
        if (!response.ok) {
            const errText = await response.text();
            console.error(`LCU Error (${response.status}):`, errText);
            throw new Error(`Status: ${response.status} - ${errText}`);
        }
        if (response.status === 204) return null;
        return await response.json();
    } catch (error) {
        console.error('Erro na requisição LCU:', error);
        throw error;
    }
});

// Função auxiliar para requests externos (DDragon/CDragon)
function fetchExternal(url, isBinary) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const request = client.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            rejectUnauthorized: false
        }, (res) => {
            // Handle Redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`[Proxy] Redirecting to: ${res.headers.location}`);
                resolve(fetchExternal(res.headers.location, isBinary));
                return;
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`Status Code: ${res.statusCode}`));
            }

            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                if (isBinary) {
                    const contentType = res.headers['content-type'] || 'image/jpeg';
                    resolve(`data:${contentType};base64,${buffer.toString('base64')}`);
                } else {
                    try {
                        resolve(JSON.parse(buffer.toString()));
                    } catch (e) {
                        resolve(buffer.toString());
                    }
                }
            });
        });

        request.on('error', (err) => {
            console.error('[Proxy] Request Error:', err);
            reject(err);
        });

        request.end();
    });
}

// Handler para requisições externas
ipcMain.handle('external-request', async (event, url, isBinary = false) => {
    console.log(`[Proxy] Fetching: ${url} (Binary: ${isBinary})`);
    try {
        return await fetchExternal(url, isBinary);
    } catch (e) {
        console.error("[Proxy] Handler Error:", e);
        throw e;
    }
});

// Handler para selecionar pasta do LoL manualmente
ipcMain.handle('select-lol-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Selecione a pasta do League of Legends'
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const selectedPath = result.filePaths[0];
    console.log("Pasta selecionada:", selectedPath);

    // Tentar ler lockfile dessa pasta imediatamente
    const creds = await getFromLockfile(selectedPath);

    if (creds) {
        manualLolPath = selectedPath; // Salvar para o loop
        lcuCredentials = creds;
        console.log('LCU Conectado via Manual Path:', creds.url);
        mainWindow.webContents.send('lcu-connected', true);
        return true; // Sucesso
    } else {
        // Se falhar, talvez o jogo esteja fechado. Salvar o path mesmo assim para tentar depois?
        // Sim, vamos salvar.
        manualLolPath = selectedPath;
        return false; // Path salvo, mas ainda não conectado (jogo fechado?)
    }
});

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
