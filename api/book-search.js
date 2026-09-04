// Vercel serverless function: proxies Naver Book Search API so the static
// frontend can search/add books without hitting browser CORS restrictions.
//
// (Switched from Aladin OpenAPI, which Aladin is shutting down — new key
// issuance ended 2026-09-04, existing keys stop working 2026-10-30.)
//
// Set these environment variables in Vercel (Project Settings > Environment
// Variables), then redeploy:
//   NAVER_CLIENT_ID
//   NAVER_CLIENT_SECRET
// (Get them free at https://developers.naver.com/apps/#/register
//  — register an app with the "검색" (Search) API enabled.)
//
// Usage from the frontend:
//   GET /api/book-search?action=search&query=제목
//   GET /api/book-search?action=cover&url=<encoded cover image url>
//
// Note: unlike Aladin, Naver's book API doesn't return page count or a
// genre/category field, so those aren't auto-filled anymore — the frontend
// leaves 페이지 blank and genre on its default for the user to fill in.

const NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/book.json";

function stripHtml(s) {
  return (s || "")
    .replace(/<\/?b>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const CLIENT_ID = process.env.NAVER_CLIENT_ID;
  const CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
  if (!CLIENT_ID || !CLIENT_SECRET) {
    res.status(500).json({
      error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET이 설정되지 않았어요. Vercel 환경변수를 확인해주세요.",
    });
    return;
  }

  const { action, query, url } = req.query || {};

  try {
    if (action === "search") {
      const q = (query || "").trim();
      if (!q) {
        res.status(400).json({ error: "query가 필요해요." });
        return;
      }
      const naverUrl = `${NAVER_SEARCH_URL}?query=${encodeURIComponent(q)}&display=15&sort=sim`;
      const nRes = await fetch(naverUrl, {
        headers: {
          "X-Naver-Client-Id": CLIENT_ID,
          "X-Naver-Client-Secret": CLIENT_SECRET,
        },
      });
      if (!nRes.ok) {
        const errText = await nRes.text();
        res.status(502).json({
          error: `네이버 API 오류 (${nRes.status})`,
          raw: errText.slice(0, 300),
        });
        return;
      }
      const data = await nRes.json();
      const items = (data.items || []).map((it) => ({
        title: stripHtml(it.title),
        author: stripHtml(it.author),
        publisher: stripHtml(it.publisher),
        pubDate: it.pubdate || "",
        cover: it.image || "",
        isbn: it.isbn || "",
        priceStandard: it.price ? Number(it.price) : null,
        description: stripHtml(it.description),
      }));
      res.status(200).json({ items });
      return;
    }

    if (action === "cover") {
      const coverUrl = (url || "").trim();
      if (!coverUrl) {
        res.status(400).json({ error: "url이 필요해요." });
        return;
      }
      try {
        const coverRes = await fetch(coverUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          },
        });
        if (coverRes.ok) {
          const arrayBuf = await coverRes.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          const contentType = coverRes.headers.get("content-type") || "image/jpeg";
          res.status(200).json({ cover: `data:${contentType};base64,${buf.toString("base64")}` });
        } else {
          res.status(200).json({ cover: coverUrl });
        }
      } catch (e) {
        res.status(200).json({ cover: coverUrl });
      }
      return;
    }

    res.status(400).json({ error: "action은 search 또는 cover 이어야 해요." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};
