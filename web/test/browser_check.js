// Real-browser check via puppeteer: load the page, verify the start screen shows,
// click Start, let the game run, and screenshot. Captures console/page errors.
const path = require("path");
const puppeteer = require("puppeteer");

(async () => {
  const dbg = path.join(__dirname, "..", "assets", "_debug");
  const url = "file://" + path.join(__dirname, "..", "index.html");
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    headless: "new",
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(url, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 300));

  // what is visible on load?
  const onLoad = await page.evaluate(() => ({
    start: !document.getElementById("startScreen").hidden,
    startDisplay: getComputedStyle(document.getElementById("startScreen")).display,
    endgameDisplay: getComputedStyle(document.getElementById("endgame")).display,
    hasAssets: !!window.ALIEN_ASSETS,
  }));
  await page.screenshot({ path: path.join(dbg, "browser_load.png") });

  // click Start and let the game run a couple of seconds
  await page.click("#startBtn");
  await new Promise((r) => setTimeout(r, 2500));
  const afterStart = await page.evaluate(() => ({
    startHidden: document.getElementById("startScreen").hidden,
    startDisplay: getComputedStyle(document.getElementById("startScreen")).display,
    endgameDisplay: getComputedStyle(document.getElementById("endgame")).display,
    crewCards: document.querySelectorAll(".crewCard").length,
    logLines: document.querySelectorAll("#log .logline").length,
  }));
  await page.screenshot({ path: path.join(dbg, "browser_game.png") });

  // select the first crew member and screenshot the action panel
  await page.evaluate(() => { const c = document.querySelector(".crewCard"); if (c) c.click(); });
  await new Promise((r) => setTimeout(r, 400));
  const acts = await page.evaluate(() => document.querySelectorAll("#actionPanel .act").length);
  await page.screenshot({ path: path.join(dbg, "browser_selected.png") });

  await browser.close();
  console.log("ON LOAD:", JSON.stringify(onLoad));
  console.log("AFTER START:", JSON.stringify(afterStart));
  console.log("action buttons for selected crew:", acts);
  console.log("errors:", errors.length ? errors : "none");
})();
