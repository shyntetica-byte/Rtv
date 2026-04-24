import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Get Trending Scripts
  app.get("/api/trending-scripts", async (req, res) => {
    try {
      // Use the base scripts page which defaults to 'trending' and ensure trailing slash
      const response = await axios.get("https://www.tradingview.com/scripts/", {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tradingview.com/',
          'Cache-Control': 'no-cache'
        }
      });
      const $ = cheerio.load(response.data);
      const scripts: any[] = [];

      // Modern TradingView selectors
      const scriptCards = $(".tv-widget-idea, .js-script-item-card, [data-name='script-card']");
      
      scriptCards.each((i, el) => {
        const $el = $(el);
        const titleEl = $el.find(".tv-widget-idea__title, .tv-script-item-card__title, a[class*='title']").first();
        const title = titleEl.text().trim();
        let link = titleEl.attr("href") || "";
        if (link && !link.startsWith("http")) {
          link = "https://www.tradingview.com" + link;
        }
        
        const author = $el.find(".tv-card-user-info__name, .tv-script-item-card__author-name, a[class*='user']").text().trim();
        const description = $el.find(".tv-widget-idea__description-text, .tv-script-item-card__description, div[class*='description']").text().trim();
        
        if (title && link) {
          scripts.push({ 
            title, 
            link, 
            author: author || "TradingView Author", 
            description: description || "No description provided." 
          });
        }
      });

      // Fallback if selectors failed but we got HTML
      if (scripts.length === 0) {
        console.warn("Scraper found 0 scripts. Structure might have changed.");
      }

      res.json({ scripts: scripts.slice(0, 20) });
    } catch (error: any) {
      console.error("Error fetching trending scripts:", error.message);
      const status = error.response?.status || 500;
      let userMessage = "TradingView scraping failed. Community structure might have shifted.";
      if (status === 404) userMessage = "Trending scripts page not found. TradingView URL might have changed.";
      if (status === 429) userMessage = "Rate limited by TradingView. Please try again in 5-10 minutes.";
      if (error.code === 'ECONNABORTED') userMessage = "Request to TradingView timed out. Try again.";
      
      res.status(status).json({ error: userMessage, details: error.message });
    }
  });

  // API Route: Fetch Script Source
  app.get("/api/fetch-script", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "Source URL is required for quantitative analysis." });
    }

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tradingview.com/scripts/',
          'Cache-Control': 'no-cache'
        },
        timeout: 10000 // 10 second timeout
      });
      const $ = cheerio.load(response.data);
      
      // Look for the source code in script tags or common containers
      let scriptSource = "";
      
      // Try to find the tv-pine-script-source script tag (Common in TV layout)
      const sourceTag = $("script").filter((i, el) => {
        const content = $(el).html() || "";
        return content.includes("//@version=");
      }).first();

      if (sourceTag.length > 0) {
        scriptSource = sourceTag.html() || "";
      } else {
        // Fallback: look for pre or code tags that might contain it
        scriptSource = $("pre").text() || $("code").text() || "";
      }

      // If it looks like a large chunk of HTML, it might be the wrong element.
      // Clean up the source if it's inside a JSON string or similar
      if (scriptSource.includes("\"source\":")) {
        try {
          const match = scriptSource.match(/"source":"([\s\S]*?)"/);
          if (match) scriptSource = JSON.parse(`"${match[1]}"`);
        } catch (e) {}
      }

      if (!scriptSource || scriptSource.length < 10) {
        return res.status(404).json({ error: "Could not retrieve script source. Script might be protected, private, or the page structure has changed." });
      }

      res.json({ source: scriptSource });
    } catch (error: any) {
      console.error("Error fetching script source:", error.message);
      const status = error.response?.status || 500;
      let userMessage = "Failed to retrieve script source from TradingView.";
      if (status === 403) userMessage = "Access denied by TradingView. They might be blocking automated source retrieval.";
      if (status === 429) userMessage = "Rate limited. TradingView is preventing further source inspection.";
      if (error.code === 'ECONNABORTED') userMessage = "Script retrieval timed out. TradingView servers are responding slowly.";
      
      res.status(status).json({ error: userMessage, details: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
