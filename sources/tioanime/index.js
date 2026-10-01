/* __FETCH_RETRY__ */
(function () {
  var g = (typeof globalThis !== 'undefined') ? globalThis
    : (typeof self !== 'undefined') ? self
    : (typeof global !== 'undefined') ? global
    : (typeof window !== 'undefined') ? window
    : null;
  if (!g || typeof g.fetch !== 'function' || g.fetch.__RETRY_WRAPPED__) return;
  var _f = g.fetch;
  function _timeoutSignal(ms) {
    try {
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
    } catch (e) {}
    try {
      if (typeof AbortController === 'function' && typeof setTimeout === 'function') {
        var c = new AbortController();
        var t = setTimeout(function () { try { c.abort(); } catch (e) {} }, ms);
        return c.signal;
      }
    } catch (e) {}
    return undefined;
  }
  function _retryFetch(url, options) {
    if (options && typeof options === 'object' && !options.signal) {
      var t = (typeof options.timeout === 'number') ? options.timeout : 15000;
      if (t > 0) { options = Object.assign({}, options, { signal: _timeoutSignal(t) }); delete options.timeout; }
    }
    return new Promise(function (resolve, reject) {
      var attempt = 0, retries = 2, base = 400, max = 3200;
      function go() {
        _f(url, options).then(function (res) {
          if (res && (res.status === 429 || res.status === 408 || (res.status >= 500 && res.status < 600)) && attempt < retries) {
            attempt++;
            setTimeout(go, Math.min(max, base * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150));
          } else { resolve(res); }
        }).catch(function (err) {
          if (err && err.name === "AbortError") { reject(err); return; }
          if (attempt < retries) { attempt++; setTimeout(go, Math.min(max, base * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 150)); }
          else { reject(err); }
        });
      }
      go();
    });
  }
  _retryFetch.__RETRY_WRAPPED__ = true;
  try { g.fetch = _retryFetch; } catch (e) {}
})();

const cheerio = require("cheerio");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const TMDB_KEY = "439c478a771f35c05022f9feabcca01c";
const BASE_URL = "https://tioanime.com";

const HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Referer": BASE_URL + "/"
};

const HTML_HEADERS_RESOLVER = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// Hosts de descarga o muertos: no son streams reproducibles.
const SKIP_HOSTS = [
  "mega.nz",
  "mega.co",
  "mediafire.com",
  "zippyshare.com",
  "embedsb.com", "streamsb.net", "sbplay.org",
  "terabox.com",
  "1fichier.com",
  "luluvdo.com", "lulustream.com",
];

// Embeds que NuvioTV puede resolver con sus extractores CloudStream.
const EMBED_SAFE_PATTERNS = [
  "yourupload.com",
  "ok.ru", "odnoklassniki.ru",
  "uqload.is", "uqload.co",
  "mp4upload.com", "streamtape.com",
  "streamwish", "strwish", "embedwish", "awish", "wishfast",
  "sfastwish", "hanerix", "hglink", "dhcplay", "hlswish",
  "filemoon", "bysesukior", "moonembed", "fmoon",
  "vidhide", "filelions", "movearnpre",
  "mixdrop", "mixdroop",
  "voe.sx",
  "hqq.tv", "netu",
  "my.mail.ru", "mail.ru",
  "v.tioanime.com",
  "vgfplay.com", "vidguard", "listeamed",
];

async function fetchText(url, headers = HTML_HEADERS_RESOLVER) {
  try {
    const resp = await fetch(url, { headers });
    if (resp.status === 404) return "DEAD";
    const text = await resp.text();
    const lower = text.toLowerCase();
    if (lower.includes("file was deleted") ||
      lower.includes("no longer exists") ||
      lower.includes("file not found") ||
      lower.includes("content restricted") ||
      lower.includes("file was locked") ||
      text.length < 100) {
      return "DEAD";
    }
    return text;
  } catch (e) { return null; }
}

function normalizeExtractedUrl(value) {
  if (!value || typeof value !== "string") return null;
  return value.replace(/\\u0026/g, "&").replace(/\\\//g, "/").replace(/&amp;/g, "&")
    .replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%3F/gi, "?").replace(/%3D/gi, "=").trim();
}

function findFirstUrl(payload, patterns) {
  if (!payload || typeof payload !== "string") return null;
  for (const pattern of patterns) {
    try {
      const match = payload.match(pattern);
      if (match && match[1]) { const c = normalizeExtractedUrl(match[1]); if (c) return c; }
    } catch (_e) {}
  }
  return null;
}

function isLikelyVideoUrl(url) {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();
  for (const p of ["cloudflareinsights", "google-analytics", "googletagmanager", "facebook.net", "beacon.min.js", ".js?", "analytics", "pixel", "bigbuckbunny", "test-videos", "sample-video", "placeholder", "cfglobalcdn", "/files/videos/2018", "/files/thumbs/2017"]) {
    if (lower.includes(p)) return false;
  }
  return /\.(mp4|m3u8)$/i.test(url) || lower.includes("video") || lower.includes("stream") || lower.includes(".mp4") || lower.includes(".m3u8");
}

// ─── StreamWish liviano ───
const STREAMWISH_MIRRORS = ["streamwish", "strwish", "embedwish", "awish", "wishfast",
  "sfastwish", "hanerix", "hglink", "dwish", "wishembed", "hlswish", "dhcplay"];

function isStreamWish(url) {
  const u = (url || "").toLowerCase();
  return STREAMWISH_MIRRORS.some(m => u.includes(m));
}

async function resolveStreamwish(embedUrl) {
  try {
    const rawId = embedUrl.split("/").pop().replace(/\.html$/, "");
    const mirrors = [
      `https://hanerix.com/e/${rawId}`,
      `https://embedwish.com/e/${rawId}`,
      `https://streamwish.to/e/${rawId}`,
      `https://strwish.com/e/${rawId}`,
      embedUrl,
    ];
    for (const mirror of mirrors) {
      try {
        const resp = await fetch(mirror, { headers: { "User-Agent": UA, "Referer": mirror } });
        if (!resp.ok) continue;
        const html = await resp.text();
        if (html.length < 500) continue;
        const hashMatch = html.match(/[0-9a-f]{32}/i);
        if (hashMatch) {
          const origin = new URL(mirror).origin;
          const dlUrl = `${origin}/dl?op=view&file_code=${rawId}&hash=${hashMatch[0]}&embed=1&hls4=1`;
          const dlResp = await fetch(dlUrl, {
            headers: { "User-Agent": UA, "Referer": mirror, "X-Requested-With": "XMLHttpRequest" }
          });
          if (dlResp.ok) {
            const dlText = await dlResp.text();
            const m = dlText.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
            if (m) return m[0];
          }
        }
        const m3 = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
        if (m3) return m3[0];
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

// ─── Filemoon liviano ───
const FILEMOON_MIRRORS = ["filemoon", "bysesukior", "moonembed", "fmoon", "bysedikamoum"];

function isFilemoon(url) {
  const u = (url || "").toLowerCase();
  return FILEMOON_MIRRORS.some(m => u.includes(m));
}

async function resolveFilemoon(embedUrl) {
  try {
    const resp = await fetch(embedUrl, { headers: { "User-Agent": UA, "Referer": embedUrl } });
    if (!resp.ok) return null;
    const html = await resp.text();
    const m3 = html.match(/https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/i);
    if (m3) return m3[0];
    const fileMatch = html.match(/file\s*:\s*["']([^"']+)["']/i);
    if (fileMatch && /\.(?:m3u8|mp4)/i.test(fileMatch[1])) return fileMatch[1];
  } catch (_) {}
  return null;
}

// ─── Genérico: busca el primer mp4/m3u8 en el HTML del embed ───
async function resolveGeneric(embedUrl) {
  try {
    const html = await fetchText(embedUrl);
    if (!html || html === "DEAD") return html === "DEAD" ? "DEAD" : null;
    const direct = html.match(/https?:\/\/[^"'\s\\]+\.(?:m3u8|mp4)[^"'\s\\]*/i);
    if (direct) {
      const cleaned = normalizeExtractedUrl(direct[0]);
      if (cleaned && isLikelyVideoUrl(cleaned)) return cleaned;
    }
    const file = findFirstUrl(html, [
      /file\s*:\s*["']([^"']+)["']/i,
      /"file"\s*:\s*"([^"]+)"/i,
      /"source"\s*:\s*"([^"]+)"/i,
      /sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    ]);
    if (file && isLikelyVideoUrl(file)) return file;
  } catch (_) {}
  return null;
}

async function resolveUrl(serverName, embedUrl) {
  if (!embedUrl) return null;
  if (embedUrl.includes("mega.nz") || embedUrl.includes("mega.co")) return null;
  const name = (serverName || "").toLowerCase();
  let resolved = null;
  try {
    if (isStreamWish(embedUrl)) {
      resolved = await resolveStreamwish(embedUrl);
      if (resolved) return resolved;
    }
    if (isFilemoon(embedUrl)) {
      resolved = await resolveFilemoon(embedUrl);
      if (resolved) return resolved;
    }
    if (name.includes("yourupload")) {
      const html = await fetchText(embedUrl);
      if (html === "DEAD") return "DEAD";
      if (html) {
        const m = /property\s*=\s*"og:video"/g.exec(html);
        if (m) { const v = /content\s*=\s*"(\S+)"/g.exec(html.substring(m.index)); if (v) resolved = v[1]; }
      }
    } else if (name.includes("mp4upload")) {
      const html = await fetchText(embedUrl);
      if (html === "DEAD") return "DEAD";
      if (html) { const m = /<script(?:.|\n)+?src:(?:.|\n)*?"(.+?\.mp4)"/g.exec(html); if (m) resolved = m[1]; }
    } else if (name.includes("voe")) {
      let html = await fetchText(embedUrl);
      if (html === "DEAD") return "DEAD";
      if (html) resolved = findFirstUrl(html, [/sources?\s*:\s*\[\s*\{[^}]*src\s*:\s*["']([^"']+)["']/i, /"file"\s*:\s*"([^"]+)"/i, /(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)[^\s"'<>]*)/i]);
      if (!isLikelyVideoUrl(resolved)) resolved = null;
    } else if (name.includes("vidhide") || name.includes("maru") && false) {
      const html = await fetchText(embedUrl);
      if (html === "DEAD") return "DEAD";
      if (html) resolved = findFirstUrl(html, [/sources?\s*:\s*\[\s*\{[^}]*(?:file|src)\s*:\s*["'](https?:\/\/[^"']+)["']/i, /"file"\s*:\s*"([^"]+)"/i, /"source"\s*:\s*"([^"]+)"/i, /file\s*:\s*'([^']+)'/i]);
      if (!isLikelyVideoUrl(resolved)) resolved = null;
    } else if (name.includes("okru") || name.includes("ok.ru") || name.includes("odnoklassniki")) {
      const html = await fetchText(embedUrl);
      if (html === "DEAD") return "DEAD";
      if (html) resolved = findFirstUrl(html, [/"metadata"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/i, /flashvars\s*=\s*\{[^}]*src\s*:\s*"([^"]+)"/i, /videoUrl\s*=\s*"([^"]+)"/i]);
      if (!isLikelyVideoUrl(resolved)) resolved = null;
    } else if (name.includes("streamtape")) {
      const html = await fetchText(embedUrl, { "Referer": BASE_URL + "/" });
      if (html === "DEAD") return "DEAD";
      if (html) {
        const rb = html.match(/id=["']robotlink["'][^>]*>([^<]+)</);
        if (rb) {
          const path = rb[1].trim();
          if (path.startsWith("//")) resolved = `https:${path}`;
          else resolved = `https://streamtape.com${path.startsWith("/") ? "" : "/"}${path}`;
        }
      }
      if (resolved && !resolved.includes("streamtape")) resolved = null;
    } else if (name.includes("uqload")) {
      const html = await fetchText(embedUrl, { "Referer": BASE_URL + "/" });
      if (html === "DEAD") return "DEAD";
      // uqload usa JS ofuscado; fallback genérico
      if (html) resolved = await resolveGeneric(embedUrl);
    } else {
      // Netu/hqq, Maru/mail.ru, Amus/Mepu (v.tioanime), StreamSB, etc.
      resolved = await resolveGeneric(embedUrl);
      if (resolved === "DEAD") return "DEAD";
      if (!isLikelyVideoUrl(resolved)) resolved = null;
    }
  } catch (err) {}
  if (resolved && (resolved.includes("mega.nz") || resolved.includes("mega.co"))) return null;
  return resolved;
}

function cleanTitle(title) {
  if (!title) return "";
  return title.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getTmdbTitles(tmdbId, type) {
  let titleEsES = null, titleEsMX = null, titleOriginal = null, titleEn = null, year = null;
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=es-ES`).then(r => r.json());
    titleEsES = type === "movie" ? res.title : res.name;
    titleOriginal = type === "movie" ? res.original_title : res.original_name;
    const dateStr = type === "movie" ? res.release_date : res.first_air_date;
    if (dateStr) year = dateStr.split("-")[0];
  } catch (e) { console.error("[TioAnime] TMDB es-ES error:", e.message); }
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=es-MX`).then(r => r.json());
    titleEsMX = type === "movie" ? res.title : res.name;
  } catch (e) { console.error("[TioAnime] TMDB es-MX error:", e.message); }
  try {
    const res = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=en-US`).then(r => r.json());
    titleEn = type === "movie" ? res.title : res.name;
  } catch (e) { console.error("[TioAnime] TMDB en-US error:", e.message); }
  return { titleEsES, titleEsMX, titleOriginal, titleEn, year };
}

function generateQueries(info) {
  const queries = [];
  const addQuery = (q) => {
    if (!q) return;
    const cleanQ = q.replace(/[,;.:!\?]/g, "").replace(/\s+/g, " ").trim();
    queries.push(cleanQ);
    const stripped = cleanQ.replace(/^(the|los|las|el|la|lo|un|una|unos|unas)\s+/i, "");
    if (stripped !== cleanQ) queries.push(stripped);
  };
  if (info.titleEsMX) addQuery(info.titleEsMX);
  if (info.titleEsES && info.titleEsES !== info.titleEsMX) addQuery(info.titleEsES);
  if (info.titleEn) addQuery(info.titleEn);
  if (info.titleOriginal) addQuery(info.titleOriginal);
  return [...new Set(queries)];
}

async function searchOnSite(query) {
  try {
    const url = `${BASE_URL}/directorio?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    $("article.anime").each((i, el) => {
      const a = $(el).find("a[href^='/anime/']").first();
      const href = a.attr("href") || "";
      if (!href.startsWith("/anime/")) return;
      const slug = href.replace("/anime/", "").replace(/\/$/, "");
      const title = $(el).find("h3.title").first().text().trim();
      if (slug && title) results.push({ slug, title });
    });
    return results;
  } catch (e) {
    console.error(`[TioAnime] Search site error for "${query}":`, e.message);
    return [];
  }
}

const getServerTitle = (serverName) => {
  if (!serverName) return "Online";
  const s = serverName.toLowerCase();
  if (s.includes("yourupload")) return "YourUpload";
  if (s.includes("okru") || s.includes("ok.ru") || s.includes("odnoklassniki")) return "Okru";
  if (s.includes("netu") || s.includes("hqq")) return "Netu";
  if (s.includes("maru") || s.includes("mail.ru")) return "Maru";
  if (s.includes("amus")) return "Amus";
  if (s.includes("mepu")) return "Mepu";
  if (s.includes("streamsb") || s.includes("sbplay")) return "StreamSB";
  if (s.includes("vidguard") || s.includes("vgfplay") || s.includes("listeamed")) return "VidGuard";
  if (s.includes("mixdrop") || s.includes("mixdroop")) return "MixDrop";
  if (s.includes("mega")) return "Mega";
  const clean = serverName.replace(/\.com|\.net|\.org|\.tv|\.to|\.sx|\.ru/gi, "");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

function parseVideosVar(html) {
  // var videos = [["Server","url",0,0],...];
  const m = html.match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  try {
    const jsonStr = m[1].replace(/\\\//g, "/");
    const raw = JSON.parse(jsonStr);
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const server = entry[0] || "Unknown";
      const url = (entry[1] || "").replace(/\\\//g, "/").trim();
      if (url && url.startsWith("http")) out.push({ server: getServerTitle(server), url });
    }
    return out;
  } catch (e) {
    console.error("[TioAnime] parseVideosVar error:", e.message);
    return [];
  }
}

async function animeHasEpisode(slug, epNum) {
  // Verifica en /anime/slug que el episodio exista (var episodes=[...]).
  try {
    const res = await fetch(`${BASE_URL}/anime/${slug}`, { headers: HEADERS });
    if (!res.ok) return true; // si no podemos verificar, intentamos igual
    const html = await res.text();
    const m = html.match(/var\s+episodes\s*=\s*(\[[^\]]*\])/);
    if (!m) return true;
    const list = JSON.parse(m[1]);
    return list.includes(Number(epNum));
  } catch (_) { return true; }
}

async function getStreams(tmdbId, mediaType, season, episode) {
  console.log(`[TioAnime] Resolving TMDB ID: ${tmdbId}, Season: ${season}, Episode: ${episode}`);

  const info = await getTmdbTitles(tmdbId, mediaType);
  if (!info.titleEsES && !info.titleEsMX && !info.titleOriginal && !info.titleEn) {
    console.log("[TioAnime] Failed to fetch titles from TMDB.");
    return [];
  }

  const uniqueQueries = generateQueries(info);
  let matchedAnime = null;
  let bestScore = -1;

  for (const q of uniqueQueries) {
    console.log(`[TioAnime] Searching with query: "${q}"`);
    const results = await searchOnSite(q);
    for (const res of results) {
      let score = 0;
      const cleanedResult = cleanTitle(res.title);
      const matchTitles = [info.titleEsMX, info.titleEsES, info.titleOriginal, info.titleEn].filter(Boolean);
      for (const t of matchTitles) {
        const cleanedT = cleanTitle(t);
        if (cleanedResult === cleanedT) score = Math.max(score, 100);
        else if (cleanedResult.includes(cleanedT) || cleanedT.includes(cleanedResult)) score = Math.max(score, 50);
      }
      console.log(`  - Candidate: "${res.title}" -> Score: ${score} -> ${res.slug}`);
      if (score > bestScore && score >= 40) {
        bestScore = score;
        matchedAnime = res;
      }
    }
    if (bestScore >= 100) break;
  }

  if (!matchedAnime) {
    console.log("[TioAnime] No matching anime found on site.");
    return [];
  }

  console.log(`[TioAnime] Matched Anime: "${matchedAnime.title}" (Score: ${bestScore}) -> ${matchedAnime.slug}`);

  const epNum = mediaType === "movie" ? 1 : episode;
  const episodeUrl = `${BASE_URL}/ver/${matchedAnime.slug}-${epNum}`;

  let episodeHtml = null;
  try {
    const res = await fetch(episodeUrl, { headers: HEADERS });
    if (!res.ok) {
      console.log(`[TioAnime] Episode page not found: ${episodeUrl} (${res.status})`);
      return [];
    }
    episodeHtml = await res.text();
  } catch (e) {
    console.error(`[TioAnime] Error fetching ${episodeUrl}:`, e.message);
    return [];
  }

  if (!episodeHtml || episodeHtml.length < 500) {
    console.log("[TioAnime] Episode page empty.");
    return [];
  }

  const candidates = parseVideosVar(episodeHtml);
  if (!candidates.length) {
    console.log("[TioAnime] No video servers found (var videos missing).");
    return [];
  }
  console.log(`[TioAnime] Found ${candidates.length} servers.`);

  const streams = [];
  for (const c of candidates) {
    const serverName = c.server;
    const embedUrl = c.url;
    if (!embedUrl) continue;
    try {
      const embedHost = new URL(embedUrl).hostname;
      if (SKIP_HOSTS.some(h => embedHost.includes(h) || embedUrl.includes(h))) {
        console.log(`[TioAnime] Skipping host: ${embedHost} (${serverName})`);
        continue;
      }
    } catch (_) {}

    console.log(`[TioAnime] Resolving server ${serverName}: ${embedUrl}`);
    const resolved = await resolveUrl(serverName, embedUrl);

    if (resolved === "DEAD") {
      console.log(`[TioAnime] Stream dead: ${embedUrl}`);
      continue;
    }
    if (resolved) {
      streams.push({
        provider: "TioAnime",
        title: `${serverName} · Direct`,
        url: resolved,
        quality: "720p",
        headers: { "Referer": embedUrl, "User-Agent": UA }
      });
    } else {
      const isEmbedSafe = EMBED_SAFE_PATTERNS.some(h => embedUrl.includes(h));
      if (isEmbedSafe) {
        streams.push({
          provider: "TioAnime",
          title: `${serverName} (Embed)`,
          url: embedUrl,
          quality: "720p",
          isEmbed: true,
          headers: { "Referer": BASE_URL + "/", "User-Agent": UA }
        });
      } else {
        console.log(`[TioAnime] Dropping non-resolvable embed: ${embedUrl}`);
      }
    }
  }

  console.log(`[TioAnime] Resolved ${streams.length} streams.`);
  const seen = new Set();
  return streams.filter(s => {
    if (!s || !s.url) return false;
    if (seen.has(s.url)) return false;
    seen.add(s.url);
    return true;
  });
}

/* __PLAYABLE_FILTER__ */
var __filterPlayable = (function () {
  return function (sources) {
    var arr = sources || [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      if (s && s.isEmbed) continue;
      if (s) out.push(s);
    }
    return out;
  };
})();
module.exports = { getStreams };
(function () {
  var _og = module.exports.getStreams;
  if (typeof _og === "function" && !_og.__PLAYABLE_WRAPPED__) {
    var _w = function () { var r = _og.apply(null, arguments); return Promise.resolve(r).then(function (s) { return __filterPlayable(s || []); }); };
    _w.__PLAYABLE_WRAPPED__ = true;
    module.exports.getStreams = _w;
  }
})();
