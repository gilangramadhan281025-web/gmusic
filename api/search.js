export default async function handler(req, res) {

  const query = req.query.q;

  if (!query) {
    return res.status(400).json({
      error: "Query kosong"
    });
  }

  const apiKey =
    process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "YOUTUBE_API_KEY belum diatur di Vercel"
    });
  }

  const url =
    "https://www.googleapis.com/youtube/v3/search" +
    "?part=snippet" +
    "&type=video" +
    "&videoCategoryId=10" +
    "&maxResults=25" +
    "&q=" +
    encodeURIComponent(query) +
    "&key=" +
    encodeURIComponent(apiKey);

  try {

    const response =
      await fetch(url);

    const data =
      await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    const items =
      (data.items || []).map(item => ({

        id:
          item.id.videoId,

        title:
          item.snippet.title,

        artist:
          item.snippet.channelTitle,

        thumbnail:
          item.snippet.thumbnails?.high?.url ||
          item.snippet.thumbnails?.medium?.url ||
          item.snippet.thumbnails?.default?.url ||
          ""

      }));

    return res.status(200).json({
      items
    });

  } catch (error) {

    return res.status(500).json({
      error: "Terjadi kesalahan server"
    });

  }

}
