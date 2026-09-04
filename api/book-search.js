// Vercel serverless function: proxies Kakao (Daum) Book Search API so the
// static frontend can search/add books without hitting browser CORS
// restrictions.
//
// (Switched from Aladin OpenAPI, which Aladin shut down for new users on
// 2026-09-04 and existing keys stop 2026-10-30. Naver's Search API was also
// tried, but Naver stopped accepting new 검색 API applications entirely —
// see https://developers.naver.com/docs/serviceapi/search/book/book.md)
//
// Set this environment variable in Vercel (Project Settings > Environment
// Variables), then redeploy:
//   KAKAO_REST_API_KEY
// (Get it free at https://developers.kakao.com/console/app
//  — create an app, then copy the "REST API 키" from the app's summary page.
//  No extra "enable search API" step needed — book search works out of the
//  box with any app's REST API key.)
//
// Usage from the frontend:
//   GET /api/book-search?action=search&query=제목
//   GET /api/book-search?action=cover&url=<encoded cover image url>
//
// Note: like the Naver attempt, Kakao's book API doesn't return page count
// or a genre/category field, so those aren't auto-filled — the frontend
// leaves 페이지 blank and genre on its default for the user to fill in.

const KAKAO_SEARCH_URL = "https://dapi.kakao.com/v3/search/book";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const REST_API_KEY = process.env.KAKAO_REST_API_KEY;
  if (!REST_API_KEY) {
    res.status(500).json({
      error: "KAKAO_REST_API_KEY가 설정되지 않았어요. Vercel 환경변수를 확인해주세요.",
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
      const kakaoUrl = `${KAKAO_SEARCH_URL}?target=title&size=15&query=${encodeURIComponent(q)}`;
      const kRes = await fetch(kakaoUrl, {
        headers: { Authorization: `KakaoAK ${REST_API_KEY}` },
      });
      if (!kRes.ok) {
        const errText = await kRes.text();
        res.status(502).json({
          error: `카카오 API 오류 (${kRes.status})`,
          raw: errText.slice(0, 300),
        });
        return;
      }
      const data = await kRes.json();
      const items = (data.documents || []).map((d) => ({
        title: d.title || "",
        author: (d.authors || []).join(", "),
        publisher: d.publisher || "",
        pubDate: (d.datetime || "").slice(0, 10).replace(/-/g, ""),
        cover: d.thumbnail || "",
        isbn: d.isbn || "",
        priceStandard: d.price || d.sale_price || null,
        description: d.contents || "",
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
