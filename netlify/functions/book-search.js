// Netlify serverless function: proxies Aladin OpenAPI so the static frontend
// can search/add books without hitting browser CORS restrictions.
//
// Set the environment variable ALADIN_TTB_KEY in Netlify
// (Project configuration > Environment variables) once the key is approved.
//
// Usage from the frontend:
//   GET /.netlify/functions/book-search?action=search&query=제목
//   GET /.netlify/functions/book-search?action=detail&itemId=12345

const ALADIN_SEARCH_URL = "https://www.aladin.co.kr/ttb/api/ItemSearch.aspx";
const ALADIN_LOOKUP_URL = "https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx";

exports.handler = async function (event) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  };

  const TTB_KEY = process.env.ALADIN_TTB_KEY;
  if (!TTB_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "ALADIN_TTB_KEY가 설정되지 않았어요. Netlify 환경변수를 확인해주세요." }),
    };
  }

  const params = event.queryStringParameters || {};
  const action = params.action;

  try {
    if (action === "search") {
      const query = (params.query || "").trim();
      if (!query) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "query가 필요해요." }) };
      }
      const url =
        `${ALADIN_SEARCH_URL}?ttbkey=${encodeURIComponent(TTB_KEY)}` +
        `&Query=${encodeURIComponent(query)}` +
        `&QueryType=Keyword&MaxResults=15&start=1&SearchTarget=Book` +
        `&output=js&Version=20131101&Cover=Big`;

      const res = await fetch(url);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: "알라딘 응답을 해석하지 못했어요.", raw: text.slice(0, 300) }) };
      }
      if (data.errorCode) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: data.errorMessage || "알라딘 API 오류" }) };
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

      return { statusCode: 200, headers, body: JSON.stringify({ items }) };
    }

    if (action === "detail") {
      const itemId = params.itemId;
      if (!itemId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "itemId가 필요해요." }) };
      }
      const url =
        `${ALADIN_LOOKUP_URL}?ttbkey=${encodeURIComponent(TTB_KEY)}` +
        `&itemIdType=ItemId&ItemId=${encodeURIComponent(itemId)}` +
        `&output=js&Version=20131101&OptResult=packing&Cover=Big`;

      const res = await fetch(url);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return { statusCode: 502, headers, body: JSON.stringify({ error: "알라딘 응답을 해석하지 못했어요.", raw: text.slice(0, 300) }) };
      }
      const item = (data.item || [])[0];
      if (!item) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "해당 책을 찾지 못했어요." }) };
      }

      // Fetch the cover image server-side and inline it as base64, so the
      // saved book stays a fully self-contained data URI like the rest of
      // the app's covers (and so the browser never needs a cross-origin
      // image fetch).
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
            coverDataUri = item.cover; // fall back to hotlinked URL if conversion fails
          }
        } catch (e) {
          coverDataUri = item.cover; // fall back to hotlinked URL if fetch throws
        }
      }

      const pages =
        item.subInfo && item.subInfo.itemPage ? item.subInfo.itemPage : null;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          title: item.title || "",
          author: item.author || "",
          publisher: item.publisher || "",
          pubDate: item.pubDate || "",
          priceStandard: item.priceStandard || null,
          categoryName: item.categoryName || "",
          pages,
          cover: coverDataUri,
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "action은 search 또는 detail 이어야 해요." }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(err) }) };
  }
};
