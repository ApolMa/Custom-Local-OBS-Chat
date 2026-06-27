(function () {
    "use strict";

    const DEFAULT_OVERLAY_CONFIG = {
        maxMessages: 15,
        transparency: 1,
        scale: 1,
        disappearTimeMs: 0,
        fromTop: false,
        alignRight: false
    };
    const DEFAULT_ACCENT = "#ff8cc8";
    const TWITCH_WS_URL = "wss://irc-ws.chat.twitch.tv:443";

    function normalizeChannel(channel) {
        return String(channel || "").trim().replace(/^#/, "").toLowerCase();
    }

    function clampNumber(value, min, max, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return fallback;
        }
        return Math.min(Math.max(number, min), max);
    }

    function normalizeOverlayConfig(config) {
        return {
            maxMessages: Math.max(1, Math.floor(clampNumber(config.maxMessages, 1, 500, DEFAULT_OVERLAY_CONFIG.maxMessages))),
            transparency: clampNumber(config.transparency, 0, 1, DEFAULT_OVERLAY_CONFIG.transparency),
            scale: clampNumber(config.scale, 0.25, 4, DEFAULT_OVERLAY_CONFIG.scale),
            disappearTimeMs: Math.max(0, Math.floor(clampNumber(config.disappearTimeMs, 0, 86400000, DEFAULT_OVERLAY_CONFIG.disappearTimeMs))),
            fromTop: Boolean(config.fromTop),
            alignRight: Boolean(config.alignRight)
        };
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function decodeTagValue(value) {
        return String(value || "")
            .replace(/\\s/g, " ")
            .replace(/\\:/g, ";")
            .replace(/\\\\/g, "\\")
            .replace(/\\r/g, "\r")
            .replace(/\\n/g, "\n");
    }

    function parseTags(rawTags) {
        const tags = {};

        if (!rawTags) {
            return tags;
        }

        rawTags.split(";").forEach((part) => {
            const separatorIndex = part.indexOf("=");
            if (separatorIndex === -1) {
                tags[part] = "";
                return;
            }

            const key = part.slice(0, separatorIndex);
            const value = part.slice(separatorIndex + 1);
            tags[key] = decodeTagValue(value);
        });

        return tags;
    }

    function parseIrcLine(line) {
        let rest = String(line || "");
        let tags = {};
        let prefix = "";
        const params = [];

        if (!rest) {
            return null;
        }

        if (rest.startsWith("@")) {
            const firstSpace = rest.indexOf(" ");
            tags = parseTags(rest.slice(1, firstSpace));
            rest = rest.slice(firstSpace + 1);
        }

        if (rest.startsWith(":")) {
            const firstSpace = rest.indexOf(" ");
            prefix = rest.slice(1, firstSpace);
            rest = rest.slice(firstSpace + 1);
        }

        const commandEnd = rest.indexOf(" ");
        const command = commandEnd === -1 ? rest : rest.slice(0, commandEnd);
        rest = commandEnd === -1 ? "" : rest.slice(commandEnd + 1);

        while (rest) {
            if (rest.startsWith(":")) {
                params.push(rest.slice(1));
                break;
            }

            const nextSpace = rest.indexOf(" ");
            if (nextSpace === -1) {
                params.push(rest);
                break;
            }

            params.push(rest.slice(0, nextSpace));
            rest = rest.slice(nextSpace + 1);

            while (rest.startsWith(" ")) {
                rest = rest.slice(1);
            }
        }

        return { command, params, prefix, tags };
    }

    function encodeWhitespace(text) {
        return [...String(text || "")]
            .map((char) => {
                if (char === " ") {
                    return "&nbsp;";
                }
                if (char === "\t") {
                    return "&nbsp;&nbsp;&nbsp;&nbsp;";
                }
                return escapeHtml(char);
            })
            .join("");
    }

    function renderAnimatedToken(text, delaySeconds) {
        return `<span class="animated-token" style="animation-delay:${delaySeconds}s">${encodeWhitespace(text)}</span>`;
    }

    function buildTwitchPositions(emotesTag) {
        const positions = {};

        if (!emotesTag) {
            return positions;
        }

        emotesTag.split("/").forEach((part) => {
            const [id, ranges] = part.split(":");
            if (!id || !ranges) {
                return;
            }

            ranges.split(",").forEach((range) => {
                const [start, end] = range.split("-").map(Number);
                if (!Number.isInteger(start) || !Number.isInteger(end)) {
                    return;
                }
                positions[start] = { end, id };
            });
        });

        return positions;
    }

    function renderTextSegment(text, emotes) {
        let textTokenIndex = 0;

        return String(text || "")
            .split(/(\s+)/)
            .map((token) => {
                if (!token) {
                    return "";
                }
                if (/^\s+$/.test(token)) {
                    return encodeWhitespace(token);
                }
                if (emotes[token]) {
                    return `<img src="${emotes[token]}" class="emote" alt="${escapeHtml(token)}">`;
                }
                const html = renderAnimatedToken(token, textTokenIndex * 0.08);
                textTokenIndex += 1;
                return html;
            })
            .join("");
    }

    function parseMessageHtml(text, emotesTag, emotes) {
        const chars = [...String(text || "")];
        const twitchPositions = buildTwitchPositions(emotesTag);
        const segments = [];
        let textBuffer = "";
        let index = 0;

        while (index < chars.length) {
            if (twitchPositions[index]) {
                if (textBuffer) {
                    segments.push({ type: "text", value: textBuffer });
                    textBuffer = "";
                }
                const twitchEmote = twitchPositions[index];
                segments.push({
                    type: "emote",
                    url: `https://static-cdn.jtvnw.net/emoticons/v2/${twitchEmote.id}/default/dark/2.0`
                });
                index = twitchEmote.end + 1;
            } else {
                textBuffer += chars[index];
                index += 1;
            }
        }

        if (textBuffer) {
            segments.push({ type: "text", value: textBuffer });
        }

        return segments
            .map((segment) => {
                if (segment.type === "emote") {
                    return `<img src="${segment.url}" class="emote" alt="">`;
                }
                return renderTextSegment(segment.value, emotes);
            })
            .join("");
    }

    function parseHexColor(color) {
        const value = String(color || "").trim();
        const shortHex = /^#([0-9a-f]{3})$/i.exec(value);
        if (shortHex) {
            const [r, g, b] = shortHex[1].split("").map((part) => parseInt(part + part, 16));
            return { r, g, b };
        }

        const fullHex = /^#([0-9a-f]{6})$/i.exec(value);
        if (fullHex) {
            return {
                r: parseInt(fullHex[1].slice(0, 2), 16),
                g: parseInt(fullHex[1].slice(2, 4), 16),
                b: parseInt(fullHex[1].slice(4, 6), 16)
            };
        }

        return null;
    }

    function parseRgbColor(color) {
        const match = /^rgba?\(([^)]+)\)$/i.exec(String(color || "").trim());
        if (!match) {
            return null;
        }

        const parts = match[1].split(",").map((part) => Number(part.trim()));
        if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
            return null;
        }

        return {
            r: Math.min(Math.max(Math.round(parts[0]), 0), 255),
            g: Math.min(Math.max(Math.round(parts[1]), 0), 255),
            b: Math.min(Math.max(Math.round(parts[2]), 0), 255)
        };
    }

    function toRgb(color) {
        return parseHexColor(color) || parseRgbColor(color);
    }

    function colorWithAlpha(color, alpha, fallback) {
        const rgb = toRgb(color) || toRgb(fallback) || { r: 255, g: 192, b: 203 };
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    }

    async function fetchJson(path) {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Failed to load ${path} (${response.status})`);
        }
        return response.json();
    }

    function showError(root, message) {
        root.innerHTML = `<div class="overlay-error">${escapeHtml(message)}</div>`;
    }

    function addToIndex(indexMap, key, messageId) {
        if (!key) {
            return;
        }

        const normalizedKey = String(key).toLowerCase();
        if (!indexMap.has(normalizedKey)) {
            indexMap.set(normalizedKey, new Set());
        }
        indexMap.get(normalizedKey).add(messageId);
    }

    function removeFromIndex(indexMap, key, messageId) {
        if (!key) {
            return;
        }

        const normalizedKey = String(key).toLowerCase();
        const messages = indexMap.get(normalizedKey);
        if (!messages) {
            return;
        }

        messages.delete(messageId);
        if (messages.size === 0) {
            indexMap.delete(normalizedKey);
        }
    }

    function ChatOverlayApp(options) {
        this.overlayType = options.overlayType;
        this.root = options.root;
        this.chat = options.chat;
        this.channel = options.channel;
        this.sevenTvUserId = options.sevenTvUserId;
        this.config = options.overlayConfig;
        this.emotes = {};
        this.messagesById = new Map();
        this.messagesByUserId = new Map();
        this.messagesByLogin = new Map();
        this.generatedMessageCount = 0;
        this.websocket = null;
        this.reconnectHandle = null;
    }

    ChatOverlayApp.prototype.applyOverlayConfig = function () {
        const alignRight = this.overlayType === "streamer" && this.config.alignRight;

        this.root.style.setProperty("--overlay-scale", String(this.config.scale));
        this.root.style.opacity = String(this.config.transparency);
        this.root.classList.toggle("overlay-root--top", this.config.fromTop);
        this.root.classList.toggle("overlay-root--right", alignRight);
        this.chat.classList.toggle("chat-stack--top", this.config.fromTop);
        this.chat.classList.toggle("chat-stack--right", alignRight);
    };

    ChatOverlayApp.prototype.isStreamerMessage = function (login) {
        return normalizeChannel(login) === this.channel;
    };

    ChatOverlayApp.prototype.shouldRenderMessage = function (login) {
        if (this.overlayType === "streamer") {
            return this.isStreamerMessage(login);
        }
        return true;
    };

    ChatOverlayApp.prototype.load7TvEmotes = async function () {
        if (this.sevenTvUserId) {
            const userResponse = await fetch(`https://7tv.io/v3/users/${encodeURIComponent(this.sevenTvUserId)}`);
            if (userResponse.ok) {
                const userData = await userResponse.json();
                const setId = userData && userData.emote_sets && userData.emote_sets[0] && userData.emote_sets[0].id;
                if (setId) {
                    const setResponse = await fetch(`https://7tv.io/v3/emote-sets/${encodeURIComponent(setId)}`);
                    if (setResponse.ok) {
                        const setData = await setResponse.json();
                        (setData.emotes || []).forEach((emote) => {
                            this.emotes[emote.name] = `https://cdn.7tv.app/emote/${emote.id}/1x.webp`;
                        });
                    }
                }
            }
        }

        const globalResponse = await fetch("https://7tv.io/v3/emote-sets/global");
        if (!globalResponse.ok) {
            throw new Error(`7TV global request failed (${globalResponse.status})`);
        }
        const globalData = await globalResponse.json();
        (globalData.emotes || []).forEach((emote) => {
            this.emotes[emote.name] = `https://cdn.7tv.app/emote/${emote.id}/1x.webp`;
        });
    };

    ChatOverlayApp.prototype.loadFfzEmotes = async function () {
        const roomResponse = await fetch(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(this.channel)}`);
        if (roomResponse.ok) {
            const roomData = await roomResponse.json();
            Object.values(roomData.sets || {}).forEach((set) => {
                (set.emoticons || []).forEach((emote) => {
                    const url = emote.urls && (emote.urls[2] || emote.urls[1] || Object.values(emote.urls)[0]);
                    if (url) {
                        this.emotes[emote.name] = url.startsWith("//") ? `https:${url}` : url;
                    }
                });
            });
        }

        const globalResponse = await fetch("https://api.frankerfacez.com/v1/set/global");
        if (!globalResponse.ok) {
            throw new Error(`FFZ global request failed (${globalResponse.status})`);
        }
        const globalData = await globalResponse.json();
        Object.values(globalData.sets || {}).forEach((set) => {
            (set.emoticons || []).forEach((emote) => {
                const url = emote.urls && (emote.urls[2] || emote.urls[1] || Object.values(emote.urls)[0]);
                if (url) {
                    this.emotes[emote.name] = url.startsWith("//") ? `https:${url}` : url;
                }
            });
        });
    };

    ChatOverlayApp.prototype.loadEmotes = async function () {
        const results = await Promise.allSettled([
            this.load7TvEmotes(),
            this.loadFfzEmotes()
        ]);

        results.forEach((result) => {
            if (result.status === "rejected") {
                console.error("Emote load error:", result.reason);
            }
        });
    };

    ChatOverlayApp.prototype.connect = function () {
        this.websocket = new WebSocket(TWITCH_WS_URL);

        this.websocket.onopen = () => {
            const nick = `justinfan${Math.floor(Math.random() * 80000) + 1000}`;
            this.websocket.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
            this.websocket.send("PASS SCHMOOPIIE");
            this.websocket.send(`NICK ${nick}`);
            this.websocket.send(`JOIN #${this.channel}`);
        };

        this.websocket.onmessage = (event) => {
            String(event.data || "")
                .split("\r\n")
                .filter(Boolean)
                .forEach((line) => this.handleLine(line));
        };

        this.websocket.onclose = () => {
            this.scheduleReconnect();
        };

        this.websocket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };
    };

    ChatOverlayApp.prototype.scheduleReconnect = function () {
        if (this.reconnectHandle) {
            return;
        }

        this.reconnectHandle = window.setTimeout(() => {
            this.reconnectHandle = null;
            this.connect();
        }, 3000);
    };

    ChatOverlayApp.prototype.handleLine = function (line) {
        const message = parseIrcLine(line);
        if (!message) {
            return;
        }

        switch (message.command) {
        case "PING":
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                const payload = message.params[0] || "tmi.twitch.tv";
                this.websocket.send(`PONG :${payload}`);
            }
            break;
        case "PRIVMSG":
            this.handlePrivmsg(message);
            break;
        case "CLEARMSG":
            this.handleClearmsg(message);
            break;
        case "CLEARCHAT":
            this.handleClearchat(message);
            break;
        default:
            break;
        }
    };

    ChatOverlayApp.prototype.handlePrivmsg = function (message) {
        const login = normalizeChannel(message.tags.login || message.prefix.split("!")[0]);
        if (!login || !this.shouldRenderMessage(login)) {
            return;
        }

        const messageId = message.tags.id || `generated-${Date.now()}-${this.generatedMessageCount++}`;
        const userId = String(message.tags["user-id"] || "");
        const displayName = message.tags["display-name"] || login;
        const color = message.tags.color || DEFAULT_ACCENT;
        const emotesTag = message.tags.emotes || "";
        const text = message.params[1] || "";

        this.addMessage({
            color,
            displayName,
            emotesTag,
            login,
            messageId,
            text,
            userId
        });
    };

    ChatOverlayApp.prototype.handleClearmsg = function (message) {
        const targetMessageId = message.tags["target-msg-id"];
        if (!targetMessageId) {
            return;
        }
        this.removeMessageById(targetMessageId);
    };

    ChatOverlayApp.prototype.handleClearchat = function (message) {
        const targetUserId = String(message.tags["target-user-id"] || "");
        const targetLogin = normalizeChannel(message.params[1] || "");

        if (targetUserId) {
            this.removeMessagesByUserId(targetUserId);
            return;
        }

        if (targetLogin) {
            this.removeMessagesByLogin(targetLogin);
            return;
        }

        this.clearAllMessages();
    };

    ChatOverlayApp.prototype.addMessage = function (message) {
        this.removeMessageById(message.messageId);

        const line = document.createElement("div");
        const accentColor = message.color || DEFAULT_ACCENT;
        const isStreamerOverlay = this.overlayType === "streamer";

        line.className = "chat_line";
        line.dataset.messageId = message.messageId;
        if (isStreamerOverlay) {
            line.innerHTML = [
                `<span class="message-container message-container--solo" style="background-color:#ffffff;border-color:${accentColor || DEFAULT_ACCENT}">`,
                `<span class="message">${parseMessageHtml(message.text, message.emotesTag, this.emotes)}</span>`,
                "</span>"
            ].join("");
        } else {
            line.innerHTML = [
                `<span class="username-container" style="background-color:${accentColor || DEFAULT_ACCENT};border-color:${accentColor || DEFAULT_ACCENT}">`,
                `<span class="username">${renderAnimatedToken(message.displayName, 0)}</span>`,
                "</span><br>",
                `<span class="message-container" style="background-color:#ffffff;border-color:${accentColor || DEFAULT_ACCENT}">`,
                `<span class="message">${parseMessageHtml(message.text, message.emotesTag, this.emotes)}</span>`,
                "</span>"
            ].join("");
        }

        this.chat.prepend(line);

        const record = {
            element: line,
            login: message.login,
            messageId: message.messageId,
            timerId: null,
            userId: message.userId
        };

        if (this.config.disappearTimeMs > 0) {
            record.timerId = window.setTimeout(() => {
                this.removeMessageById(message.messageId);
            }, this.config.disappearTimeMs);
        }

        this.messagesById.set(message.messageId, record);
        addToIndex(this.messagesByUserId, message.userId, message.messageId);
        addToIndex(this.messagesByLogin, message.login, message.messageId);
        this.trimOverflow();
        this.updateStreamerMessageOpacity();
    };

    ChatOverlayApp.prototype.trimOverflow = function () {
        while (this.chat.childElementCount > this.config.maxMessages) {
            const oldest = this.chat.lastElementChild;
            if (!oldest) {
                break;
            }
            this.removeMessageById(oldest.dataset.messageId);
        }
    };

    ChatOverlayApp.prototype.removeMessageById = function (messageId) {
        const record = this.messagesById.get(messageId);
        if (!record) {
            return;
        }

        if (record.timerId) {
            window.clearTimeout(record.timerId);
        }

        if (record.element && record.element.parentNode) {
            record.element.parentNode.removeChild(record.element);
        }

        this.messagesById.delete(messageId);
        removeFromIndex(this.messagesByUserId, record.userId, messageId);
        removeFromIndex(this.messagesByLogin, record.login, messageId);
        this.updateStreamerMessageOpacity();
    };

    ChatOverlayApp.prototype.removeMessagesByUserId = function (userId) {
        const messageIds = this.messagesByUserId.get(String(userId).toLowerCase());
        if (!messageIds) {
            return;
        }
        Array.from(messageIds).forEach((messageId) => this.removeMessageById(messageId));
    };

    ChatOverlayApp.prototype.removeMessagesByLogin = function (login) {
        const messageIds = this.messagesByLogin.get(normalizeChannel(login));
        if (!messageIds) {
            return;
        }
        Array.from(messageIds).forEach((messageId) => this.removeMessageById(messageId));
    };

    ChatOverlayApp.prototype.clearAllMessages = function () {
        Array.from(this.messagesById.keys()).forEach((messageId) => this.removeMessageById(messageId));
    };

    ChatOverlayApp.prototype.updateStreamerMessageOpacity = function () {
        if (this.overlayType !== "streamer") {
            return;
        }

        const lines = Array.from(this.chat.children);
        const maxRank = Math.max(this.config.maxMessages - 1, 1);

        lines.forEach((line, index) => {
            const fadeStrength = index / maxRank;
            const opacity = 1 - (fadeStrength * 0.65);
            line.style.opacity = String(Math.max(0.35, opacity));
        });
    };

    ChatOverlayApp.prototype.start = async function () {
        this.applyOverlayConfig();
        await this.loadEmotes();
        this.connect();
    };

    async function init(options) {
        const overlayType = options && options.overlayType === "streamer" ? "streamer" : "main";
        const root = document.getElementById("app");
        const chat = document.getElementById("chat");

        if (!root || !chat) {
            throw new Error("Overlay root elements are missing.");
        }

        try {
            const sharedConfig = await fetchJson(options.sharedConfigPath);
            const overlayConfig = normalizeOverlayConfig({
                ...DEFAULT_OVERLAY_CONFIG,
                ...(await fetchJson(options.overlayConfigPath))
            });
            const channel = normalizeChannel(sharedConfig.channel);

            if (!channel) {
                throw new Error("Shared config must include a valid channel.");
            }

            const app = new ChatOverlayApp({
                chat,
                channel,
                overlayConfig,
                overlayType,
                root,
                sevenTvUserId: String(sharedConfig.sevenTvUserId || "")
            });

            await app.start();
        } catch (error) {
            console.error(error);
            showError(root, error.message || "Overlay failed to initialize.");
        }
    }

    window.ChatOverlay = { init };
}());
