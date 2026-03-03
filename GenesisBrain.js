/**
 * GenesisBrain.js — Universal Spectral & Atomic Nervous System
 * v4.1 - Single source of truth for all apps
 *
 * Table:   genesis_brain (namespace TEXT PK, version INT, payload JSONB)
 * Project: inversion_sim_db — xoolmbmnzbsvcqeyqvyi.supabase.co
 *
 * Any app using this file gets:
 *   - Instant write to Supabase via REST
 *   - Instant receive from ALL other apps via WebSocket push (no polling)
 *   - Spectral light helpers (nmToRGB)
 *   - Atomic element registry (ELEMENTS)
 */

const GenesisBrain = (() => {

    // ============================================================
    // CREDENTIALS — single project, all apps point here
    // ============================================================
    const SUPABASE_URL = 'https://xoolmbmnzbsvcqeyqvyi.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhvb2xtYm1uemJzdmNleXhxdnlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0NDMwNDQsImV4cCI6MjA4NzAxOTA0NH0.ebTwMZ_byU6EXtuR0jynct64QO5ornQrCwElQ5b9TxQ';
    // ============================================================

    const API  = `${SUPABASE_URL}/rest/v1`;
    const HDRS = {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal'
    };

    // --- INTERNAL STATE — all known namespaces ---
    let state = {
        sim3:    {},    // sim3colts — balls, chaos_ratio, inversions, wall_heat, scan_level
        billiard: {}, swarm: {}, medical: {}, tech: {},
        band: {},       // Live AI Band — bpm, chord, chaos, winding per voice
        smell:   {},    // Olfactory diffusion engine — dominant_element, element_mix, synthesis_level
        _connected: false,
        _version: 0
    };

    // --- THE ATOMIC PERIODIC TABLE ---
    const ELEMENTS = {
        H:  { pulse: 0.1, type: 'odd',  logic: 'assimilation' },
        He: { pulse: 0.2, type: 'even', logic: 'structure'    },
        Li: { pulse: 0.3, type: 'odd',  logic: 'attraction'   },
        Be: { pulse: 0.4, type: 'even', logic: 'structure'    },
        B:  { pulse: 0.5, type: 'odd',  logic: 'repulsion'    },
        C:  { pulse: 0.6, type: 'even', logic: 'structure'    },
        N:  { pulse: 0.7, type: 'odd',  logic: 'assimilation' },
        O:  { pulse: 0.8, type: 'even', logic: 'structure'    }
    };

    // --- EVENT EMITTER ---
    const listeners = {};
    const on   = (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); };
    const emit = (event, ...args) => (listeners[event] || []).forEach(fn => fn(...args));

    // --- PHYSICS HELPERS: SPECTRAL LIGHT ---
    // Maps 0.0-1.0 to the human visible spectrum (380nm-750nm)
    const nmToRGB = (val) => {
        const wl = 380 + (val * 370);
        let r, g, b;
        if      (wl >= 380 && wl < 440) { r = -(wl-440)/(440-380); g = 0;                  b = 1; }
        else if (wl >= 440 && wl < 490) { r = 0;                    g = (wl-440)/(490-440); b = 1; }
        else if (wl >= 490 && wl < 510) { r = 0;                    g = 1;                  b = -(wl-510)/(510-490); }
        else if (wl >= 510 && wl < 580) { r = (wl-510)/(580-510);   g = 1;                  b = 0; }
        else if (wl >= 580 && wl < 645) { r = 1;                    g = -(wl-645)/(645-580); b = 0; }
        else if (wl >= 645 && wl <= 750){ r = 1;                    g = 0;                  b = 0; }
        else                            { r = 0;                    g = 0;                  b = 0; }
        return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(b*255)})`;
    };

    // --- DATABASE WRITE — upsert to genesis_brain ---
    const upsert = async (namespace, payload) => {
        try {
            const v = (state[namespace]?._version || 0) + 1;
            state[namespace] = { ...payload, _version: v }; // optimistic local update
            await fetch(`${API}/genesis_brain`, {
                method: 'POST',
                headers: HDRS,
                body: JSON.stringify({
                    namespace,
                    version: v,
                    payload: { ...payload, _ts: Date.now() }
                })
            });
        } catch (e) { console.error('GenesisBrain write error:', e); }
    };

    // --- REALTIME WEBSOCKET — receives every write from every app instantly ---
    let ws = null;
    let _heartbeatTimer = null;

    const connectWS = () => {
        const url = SUPABASE_URL.replace('https://', 'wss://') +
                    `/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`;
        ws = new WebSocket(url);

        ws.onopen = () => {
            // postgres_changes subscription — this is what was missing in v4.0
            // Without this the WS connects but receives nothing
            ws.send(JSON.stringify({
                topic:   'realtime:public:genesis_brain',
                event:   'phx_join',
                payload: {
                    config: {
                        broadcast:        { self: false },
                        presence:         { key: '' },
                        postgres_changes: [{ event: '*', schema: 'public', table: 'genesis_brain' }]
                    }
                },
                ref: '1'
            }));
            state._connected = true;
            emit('connected');

            // Heartbeat every 25s — keeps WS alive
            if (_heartbeatTimer) clearInterval(_heartbeatTimer);
            _heartbeatTimer = setInterval(() => {
                if (ws?.readyState === 1)
                    ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: null }));
            }, 25000);
        };

        ws.onmessage = (e) => {
            try {
                const msg = JSON.parse(e.data);
                // Supabase wraps record differently for INSERT vs UPDATE
                const rec = msg?.payload?.data?.record
                         || msg?.payload?.data?.new
                         || msg?.payload?.record;
                if (rec?.namespace) {
                    state[rec.namespace] = { ...rec.payload, _version: rec.version };
                    state._version++;
                    emit('update', rec.namespace, state[rec.namespace]); // generic: on('update', (ns, data) => {})
                    emit(rec.namespace, state[rec.namespace]);           // targeted: on('band', (data) => {})
                }
            } catch (_) {}
        };

        ws.onclose = () => {
            state._connected = false;
            if (_heartbeatTimer) clearInterval(_heartbeatTimer);
            setTimeout(connectWS, 4000); // always reconnect
        };

        ws.onerror = () => ws.close(); // triggers onclose → reconnect
    };

    // --- PUBLIC API ---
    return {
        // Call once on app start — loads current state, then opens realtime WS
        connect: async () => {
            try {
                const r    = await fetch(`${API}/genesis_brain?select=*`, { headers: HDRS });
                const rows = await r.json();
                if (Array.isArray(rows)) {
                    rows.forEach(row => {
                        if (row.namespace)
                            state[row.namespace] = { ...row.payload, _version: row.version };
                    });
                }
            } catch (e) { console.warn('GenesisBrain initial fetch failed:', e); }
            connectWS();
            return state;
        },

        // write(ns, data) — persists to Supabase, WS pushes to all connected apps
        write: (ns, data) => upsert(ns, data),

        // on(event, fn) listeners:
        //   'connected'  — WS is live
        //   'update'     — any namespace: fn(namespace, payload)
        //   'band'       — band changed: fn(payload)  bpm/chord/chaos/winding
        //   'billiard'   — billiard sim: fn(payload)
        //   (any namespace string works)
        on,

        nmToRGB,
        ELEMENTS,

        get state()       { return state; },
        get isConnected() { return state._connected; },

        // Convenience getters — read without async
        get sim3()     { return state.sim3     || {}; },
        get band()     { return state.band     || {}; },
        get billiard() { return state.billiard || {}; },
        get swarm()    { return state.swarm    || {}; },
        get medical()  { return state.medical  || {}; },
        get tech()     { return state.tech     || {}; },
        get smell()    { return state.smell    || {}; },
    };
})();