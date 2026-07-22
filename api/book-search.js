// Vercel serverless function: proxies Aladin OpenAPI so the static frontend
// can search/add books without hitting browser CORS restrictions.
//
// Set the environment variable ALADIN_TTB_KEY in Vercel
// (Project Settings > Environment Variables), then redeploy.
//
// Usage from the frontend:
//   GET /api/book-search?action=search&query=제목
//   GET /api/book-search?action=detail&itemId=12345

const ALADIN_SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";
const ALADIN_LOOKUP_URL = "https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  const TTB_KEY = process.env.ALADIN_TTB_KEY;
  if (!TTB_KEY) {
    res.status(500).json({ error: "ALADIN_TTB_KEY가 설정되지 않았어요. Vercel 환경변수를 확인해주세요." });
    return;
  }

  const { action, query, itemId } = req.query || {};

  try {
    if (action === "search") {
      const q = (query || "").trim();
      if (!q) {
        res.status(400).json({ error: "query가 필요해요." });
        return;
      }
      const url =
        `${ALADIN_SEARCH_URL}?ttbkey=${encodeURIComponent(TTB_KEY)}` +
        `&Query=${encodeURIComponent(q)}` +
        `&QueryType=Keyword&MaxResults=15&start=1&SearchTarget=Book` +
        `&output=js&Version=20131101&Cover=Big`;

      const aRes = await fetch(url);
      const text = await aRes.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        res.status(502).json({ error: "알라딘 응답을 해석하지 못했어요.", raw: text.slice(0, 300) });
        return;
      }
      if (data.errorCode) {
        res.status(502).json({ error: data.errorMessage || "알라딘 API 오류" });
        return;
      }

      const items = (data.item || []).map((it) => ({
        itemId: it.itemId,
        isbn13: it.isbn13,
        title: it.title,
        author: it.author,
        publisher: it.publisher,
        pubDate: it.pubDate,
        cover: it.cover,
        priceStandard: it.priceStandard,
        categoryName: it.categoryName,
      }));

      res.status(200).json({ items });
      return;
    }

    if (action === "detail") {
      if (!itemId) {
        res.status(400).json({ error: "itemId가 필요해요." });
        return;
      }
      const url =
        `${ALADIN_LOOKUP_URL}?ttbkey=${encodeURIComponent(TTB_KEY)}` +
        `&itemIdType=ItemId&ItemId=${encodeURIComponent(itemId)}` +
        `&output=js&Version=20131101&OptResult=packing&Cover=Big`;

      const aRes = await fetch(url);
      const text = await aRes.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        res.status(502).json({ error: "알라딘 응답을 해석하지 못했어요.", raw: text.slice(0, 300) });
        return;
      }
      const item = (data.item || [])[0];
      if (!item) {
        res.status(404).json({ error: "해당 책을 찾지 못했어요." });
        return;
      }

      let coverDataUri = null;
      if (item.cover) {
        try {
          const coverRes = await fetch(item.cover, {
            headers: {
              "Referer": "https://www.aladin.co.kr/",
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            },
          });
          if (coverRes.ok) {
            const arrayBuf = await coverRes.arrayBuffer();
            const buf = Buffer.from(arrayBuf);
            const contentType = coverRes.headers.get("content-type") || "image/jpeg";
            coverDataUri = `data:${contentType};base64,${buf.toString("base64")}`;
          } else {
            coverDataUri = item.cover;
          }
        } catch (e) {
          coverDataUri = item.cover;
        }
      }

      const pages =
        item.subInfo && item.subInfo.itemPage ? item.subInfo.itemPage : null;

      res.status(200).json({
        title: item.title || "",
        author: item.author || "",
        publisher: item.publisher || "",
        pubDate: item.pubDate || "",
        priceStandard: item.priceStandard || null,
        categoryName: item.categoryName || "",
        description: item.description || "",
        pages,
        cover: coverDataUri,
      });
      return;
    }

    res.status(400).json({ error: "action은 search 또는 detail 이어야 해요." });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
};
