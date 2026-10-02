require('dotenv').config();
const express = require('express');
const path = require('path');

const { YOUTUBE_API_KEY: KEY, LRCLIB_USER_AGENT: UA = 'GMUSIC/1.0', PORT = 3000 } = process.env;
if (!KEY) console.warn('[GMUSIC] YOUTUBE_API_KEY is missing in .env: search will fail.');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---- helpers ----
const cache = new Map(); // tiny TTL cache to save API quota
const cached = async (key, ttl, fn) => {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttl });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return val;
};

const yt = async (endpoint, params) => {
  const u = new URL('https://www.googleapis.com/youtube/v3/' + endpoint);
  Object.entries({ ...params, key: KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'YouTube API error');
  return j;
};

const decode = s => (s || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const cleanTitle = s => decode(s).replace(/\s*[\(\[](official|lyrics?|audio|video|music video|hd|4k|visuali[sz]er)[^\)\]]*[\)\]]/gi, '').trim();
const cleanArtist = s => decode(s).replace(/ - Topic$/, '').replace(/VEVO$/i, '').trim();
const seconds = iso => {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
};
const thumb = s => s?.thumbnails?.medium?.url || s?.thumbnails?.default?.url || '';

async function hydrate(items, getId) {
  const ids = items.map(getId).filter(Boolean);
  if (!ids.length) return [];
  const d = await yt('videos', { part: 'contentDetails,snippet', id: ids.join(',') });
  return d.items.map(v => ({
    id: v.id, type: 'song', title: cleanTitle(v.snippet.title), artist: cleanArtist(v.snippet.channelTitle),
    thumb: thumb(v.snippet), duration: seconds(v.contentDetails.duration)
  }));
}

// ---- routes ----
app.get('/api/search', async (req, res) => {
  try {
    const { q, source = 'ytmusic', filter = 'songs' } = req.query;
    if (!q) return res.json({ items: [] });
    const items = await cached(`s:${source}:${filter}:${q}`, 10 * 60e3, async () => {
      const p = { part: 'snippet', maxResults: 20, safeSearch: 'moderate' };
      if (filter === 'albums') {
        const d = await yt('search', { ...p, q: q + ' album', type: 'playlist' });
        return d.items.map(i => ({
          id: i.id.playlistId, type: 'album', title: decode(i.snippet.title),
          artist: cleanArtist(i.snippet.channelTitle), thumb: thumb(i.snippet), duration: 0
        }));
      }
      const params = { ...p, type: 'video', q: filter === 'videos' ? q + ' music video' : q };
      if (source === 'ytmusic' && filter === 'songs') params.videoCategoryId = 10; // Music category
      const d = await yt('search', params);
      return hydrate(d.items, i => i.id.videoId);
    });
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/playlist', async (req, res) => {
  try {
    const { id } = req.query;
    const items = await cached(`p:${id}`, 30 * 60e3, async () => {
      const d = await yt('playlistItems', { part: 'snippet', maxResults: 50, playlistId: id });
      return hydrate(d.items, i => i.snippet.resourceId?.videoId);
    });
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/lyrics', async (req, res) => {
  try {
    const { title = '', artist = '', duration = '' } = req.query;
    const data = await cached(`l:${artist}:${title}`, 24 * 3600e3, async () => {
      const h = { 'User-Agent': UA };
      let r = await fetch(`https://lrclib.net/api/get?${new URLSearchParams({ track_name: title, artist_name: artist, duration })}`, { headers: h });
      if (r.ok) return r.json();
      r = await fetch(`https://lrclib.net/api/search?${new URLSearchParams({ q: `${artist} ${title}` })}`, { headers: h });
      const list = r.ok ? await r.json() : [];
      return list.find(x => x.syncedLyrics) || list[0] || null;
    });
    res.json({ synced: data?.syncedLyrics || null, plain: data?.plainLyrics || null });
  } catch (e) { res.json({ synced: null, plain: null }); }
});

app.listen(PORT, () => console.log(`GMUSIC running on http://localhost:${PORT}`));

