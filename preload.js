const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Escutar eventos de conexão
    onConnectionStatus: (callback) => ipcRenderer.on('lcu-connected', (event, isConnected) => callback(isConnected)),

    // Fazer requisições ao LCU
    request: (endpoint, method, body) => ipcRenderer.invoke('lcu-request', endpoint, method, body),

    // Fazer requisições externas (Correção de CORS)
    externalRequest: (url, isBinary) => ipcRenderer.invoke('external-request', url, isBinary)
});
