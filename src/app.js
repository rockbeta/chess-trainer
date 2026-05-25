import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const STOCKFISH_SCRIPT =
  new URL("../vendor/stockfish/stockfish.wasm.js", import.meta.url);
const STOCKFISH_FALLBACK_SCRIPT =
  new URL("../vendor/stockfish/stockfish.js", import.meta.url);

const SAMPLE_MOVES = `1. d4 c6 2. Nf3 d5 3. e3 e6 4. Bd3 c5 5. dxc5 Bxc5 6. Nbd2 Nc6 7. c3 Nge7 8. O-O Bd7 9. e4 O-O 10. exd5 Nxd5 11. Re1 Nf4 12. Bb1 Qg5 13. g3 Nh3+ 14. Kg2 Qh5 15. Qc2 Bxf2 16. Rf1 Be3 17. Ne4 Bxc1 18. Qxc1 Ne7 19. Nf2 Nxf2 20. Rxf2 Bc6 21. Kg1 Bxf3 22. Qe3 Bc6 23. Bd3 Rae8 24. Be2 Qd5 25. Bf3 Qb5 26. Qxa7 Bxf3 27. Rxf3 Qxb2 28. Raf1 Nd5 29. Qd4 Rc8 30. c4 Nf6 31. a4 Qxd4+`;

const PIECES = {
  wk: "\u2654",
  wq: "\u2655",
  wr: "\u2656",
  wb: "\u2657",
  wn: "\u2658",
  wp: "\u2659",
  bk: "\u265A",
  bq: "\u265B",
  br: "\u265C",
  bb: "\u265D",
  bn: "\u265E",
  bp: "\u265F",
};

const state = {
  imageFile: null,
  moves: [],
  errors: [],
  currentPly: 0,
  analysis: new Map(),
  engine: null,
  analyzing: false,
};

const els = {
  engineStatus: document.querySelector("#engineStatus"),
  imageInput: document.querySelector("#imageInput"),
  ocrButton: document.querySelector("#ocrButton"),
  imagePreview: document.querySelector("#imagePreview"),
  previewWrap: document.querySelector("#previewWrap"),
  canvas: document.querySelector("#preprocessCanvas"),
  pgnText: document.querySelector("#pgnText"),
  depthInput: document.querySelector("#depthInput"),
  depthValue: document.querySelector("#depthValue"),
  maxPliesInput: document.querySelector("#maxPliesInput"),
  analyzeButton: document.querySelector("#analyzeButton"),
  parseButton: document.querySelector("#parseButton"),
  sampleButton: document.querySelector("#sampleButton"),
  progressFill: document.querySelector("#progressFill"),
  logLine: document.querySelector("#logLine"),
  parseErrors: document.querySelector("#parseErrors"),
  board: document.querySelector("#board"),
  boardCaption: document.querySelector("#boardCaption"),
  moveList: document.querySelector("#moveList"),
  toStartButton: document.querySelector("#toStartButton"),
  prevButton: document.querySelector("#prevButton"),
  nextButton: document.querySelector("#nextButton"),
  toEndButton: document.querySelector("#toEndButton"),
  positionMetric: document.querySelector("#positionMetric"),
  playedMetric: document.querySelector("#playedMetric"),
  evalMetric: document.querySelector("#evalMetric"),
  alternativeList: document.querySelector("#alternativeList"),
};

renderBoard(new Chess());
renderMoveList();
renderAnalysis();
wireEvents();

function wireEvents() {
  els.imageInput.addEventListener("change", onImageSelected);
  els.ocrButton.addEventListener("click", runOcr);
  els.analyzeButton.addEventListener("click", analyzeGame);
  els.parseButton.addEventListener("click", parseCurrentText);
  els.sampleButton.addEventListener("click", () => {
    els.pgnText.value = SAMPLE_MOVES;
    parseCurrentText();
  });

  els.depthInput.addEventListener("input", () => {
    els.depthValue.value = els.depthInput.value;
  });

  els.toStartButton.addEventListener("click", () => goToPly(0));
  els.prevButton.addEventListener("click", () => goToPly(Math.max(0, state.currentPly - 1)));
  els.nextButton.addEventListener("click", () => goToPly(Math.min(state.moves.length, state.currentPly + 1)));
  els.toEndButton.addEventListener("click", () => goToPly(state.moves.length));
}

function onImageSelected(event) {
  const [file] = event.target.files || [];
  state.imageFile = file || null;
  els.ocrButton.disabled = !state.imageFile;

  if (!state.imageFile) {
    els.previewWrap.classList.remove("has-image");
    els.imagePreview.removeAttribute("src");
    return;
  }

  els.imagePreview.src = URL.createObjectURL(state.imageFile);
  els.previewWrap.classList.add("has-image");
  setLog("Image ready. Run OCR when you want to extract the moves.");
}

async function runOcr() {
  if (!state.imageFile) return;
  setBusy(true, "OCR running");
  setProgress(4);

  try {
    const imageForOcr = await preprocessImage(state.imageFile);
    const logger = (message) => {
      if (message.status === "recognizing text" && message.progress) {
        setProgress(10 + Math.round(message.progress * 70));
        setLog(`OCR recognizing text: ${Math.round(message.progress * 100)}%`);
      } else if (message.status) {
        setLog(`OCR ${message.status}`);
      }
    };

    let text = "";
    if (window.Tesseract?.createWorker) {
      const worker = await window.Tesseract.createWorker("eng", 1, { logger });
      await worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: "6",
        tessedit_char_whitelist:
          "0123456789abcdefghKQRBNOPxXO-=+#. ",
      });
      const result = await worker.recognize(imageForOcr);
      text = result.data.text || "";
      await worker.terminate();
    } else if (window.Tesseract?.recognize) {
      const result = await window.Tesseract.recognize(imageForOcr, "eng", { logger });
      text = result.data.text || "";
    } else {
      throw new Error("Tesseract.js did not load.");
    }

    els.pgnText.value = cleanMoveText(text);
    setProgress(100);
    setLog("OCR complete. Review the move text, then analyze.");
    parseCurrentText();
  } catch (error) {
    setLog(`OCR failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function preprocessImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 1800;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = els.canvas;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  const data = context.getImageData(0, 0, width, height);
  for (let index = 0; index < data.data.length; index += 4) {
    const r = data.data[index];
    const g = data.data[index + 1];
    const b = data.data[index + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const boosted = gray > 145 ? 255 : Math.max(0, gray - 28);
    data.data[index] = boosted;
    data.data[index + 1] = boosted;
    data.data[index + 2] = boosted;
  }
  context.putImageData(data, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare image for OCR."));
    }, "image/png");
  });
}

function parseCurrentText() {
  const result = parseMoves(els.pgnText.value);
  state.moves = result.moves;
  state.errors = result.errors;
  state.analysis.clear();
  state.currentPly = Math.min(state.currentPly, state.moves.length);

  renderMoveList();
  goToPly(state.currentPly);
  renderParseErrors();

  if (state.moves.length) {
    setLog(`Parsed ${state.moves.length} moves. Ready to analyze.`);
  } else {
    setLog("No legal moves parsed yet.");
  }

  return result;
}

function parseMoves(rawText) {
  const tokens = tokenizeMoves(cleanMoveText(rawText));
  const chess = new Chess();
  const moves = [];
  const errors = [];

  tokens.forEach((token) => {
    const beforeFen = chess.fen();
    const repaired = repairMoveToken(token);
    const candidates = buildMoveCandidates(repaired);
    let move = null;
    let usedToken = repaired;

    for (const candidate of candidates) {
      try {
        move = chess.move(candidate, { strict: false });
        usedToken = candidate;
        break;
      } catch {
        move = null;
      }
    }

    if (!move) {
      const legal = chess.moves({ verbose: true });
      const normalizedToken = normalizeSanForCompare(repaired);
      const fuzzy = legal.find((legalMove) => normalizeSanForCompare(legalMove.san) === normalizedToken);
      if (fuzzy) {
        move = chess.move(fuzzy.san, { strict: false });
        usedToken = fuzzy.san;
      }
    }

    if (!move) {
      errors.push({ token, fen: beforeFen });
      return;
    }

    moves.push({
      ply: moves.length + 1,
      number: Math.ceil((moves.length + 1) / 2),
      side: move.color,
      beforeFen,
      afterFen: chess.fen(),
      san: move.san,
      input: usedToken,
      uci: moveToUci(move),
      from: move.from,
      to: move.to,
      promotion: move.promotion || "",
    });
  });

  return { moves, errors };
}

function cleanMoveText(input) {
  return input
    .normalize("NFKC")
    .replace(/[|]/g, "I")
    .replace(/[×]/g, "x")
    .replace(/[–—−]/g, "-")
    .replace(/0\s*-\s*0\s*-\s*0/gi, "O-O-O")
    .replace(/0\s*-\s*0/gi, "O-O")
    .replace(/\bOOO\b/gi, "O-O-O")
    .replace(/\bOO\b/gi, "O-O")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMoves(text) {
  return text
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\{[^}]*}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\d+\s*\.\s*\.\./g, " ")
    .replace(/\d+\s*\./g, " ")
    .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^(?:Options|Explore|Back|Forward)$/i.test(token));
}

function repairMoveToken(token) {
  let repaired = token
    .replace(/^[^a-hKQRBNO0]+/i, "")
    .replace(/[^a-hKQRBNO0x=+#\-1-8]+$/i, "")
    .replace(/[,:;]+$/g, "");

  if (/^[o0][- ]?[o0]([- ]?[o0])?[+#]?$/i.test(repaired)) {
    const suffix = repaired.endsWith("+") || repaired.endsWith("#") ? repaired.slice(-1) : "";
    const core = repaired.replace(/[+#]/g, "").replace(/[o0]/gi, "O").replace(/\s+/g, "-");
    return core.length > 3 ? `O-O-O${suffix}` : `O-O${suffix}`;
  }

  repaired = repaired.replace(/([a-h])([Il])([+#]?)$/g, "$11$3");
  repaired = repaired.replace(/([KQRBN])([a-h])([Il])([+#]?)$/g, "$1$21$4");
  repaired = repaired.replace(/([a-h])x([a-h])([Il])([+#]?)$/g, "$1x$21$4");
  repaired = repaired.replace(/([KQRBN])x([a-h])([Il])([+#]?)$/g, "$1x$21$4");
  repaired = repaired.replace(/([a-h])O([+#]?)$/g, "$10$2");

  return repaired;
}

function buildMoveCandidates(token) {
  const candidates = new Set([token]);
  candidates.add(token.replace(/[+#]+$/g, ""));

  if (/[Il]/.test(token)) {
    candidates.add(token.replace(/[Il]/g, "1"));
  }

  if (/^0/.test(token)) {
    candidates.add(token.replace(/0/g, "O"));
  }

  if (!/[QRBN]=/.test(token) && /=/.test(token) === false && /[a-h][18][QRBN]?$/.test(token)) {
    candidates.add(token.replace(/([a-h][18])([QRBN])$/, "$1=$2"));
  }

  return [...candidates].filter(Boolean);
}

function normalizeSanForCompare(san) {
  return san
    .replace(/[+#?!]/g, "")
    .replace(/0/g, "O")
    .replace(/[Il]/g, "1");
}

async function analyzeGame() {
  if (state.analyzing) return;

  const parsed = parseCurrentText();
  if (!parsed.moves.length) return;

  state.analyzing = true;
  setBusy(true, "Engine running");
  setEngineStatus("Engine loading", true);
  setProgress(0);

  try {
    if (!state.engine) {
      state.engine = new StockfishClient();
      await state.engine.init();
    }

    const depth = Number(els.depthInput.value);
    const maxPlies = Math.min(Number(els.maxPliesInput.value) || parsed.moves.length, parsed.moves.length);

    for (let index = 0; index < maxPlies; index += 1) {
      const move = parsed.moves[index];
      setLog(`Analyzing ${move.number}${move.side === "b" ? "..." : "."} ${move.san}`);
      setEngineStatus(`Analyzing ${index + 1}/${maxPlies}`, true);
      setProgress(Math.round((index / maxPlies) * 100));

      const before = await state.engine.analyze(move.beforeFen, {
        depth,
        multipv: 4,
      });
      const candidateLines = before.lines.length >= 4
        ? before.lines
        : await state.engine.analyzeTopMoves(move.beforeFen, {
            depth: Math.max(5, depth - 1),
            count: 4,
          });

      let playedLine = candidateLines.find((line) => line.uci === move.uci);
      let playedScore = playedLine?.scoreWhite ?? null;
      let playedDisplay = playedLine?.displayScore ?? null;

      if (!playedLine) {
        const after = await state.engine.analyze(move.afterFen, {
          depth: Math.max(6, depth - 2),
          multipv: 1,
        });
        const bestAfter = after.lines[0];
        if (bestAfter) {
          playedScore = bestAfter.scoreWhite;
          playedDisplay = bestAfter.displayScore;
        }
      }

      const alternatives = buildAlternatives(move, candidateLines, playedScore);
      state.analysis.set(move.ply, {
        playedScore,
        playedDisplay,
        bestLine: candidateLines[0] || null,
        alternatives,
      });

      if (state.currentPly === move.ply) renderAnalysis();
      renderMoveList();
    }

    setProgress(100);
    setLog(`Analysis complete for ${maxPlies} moves.`);
    setEngineStatus("Engine ready", false);
    goToPly(Math.min(state.currentPly || 1, state.moves.length));
  } catch (error) {
    setLog(`Analysis failed: ${error.message}`);
    setEngineStatus("Engine error", false);
  } finally {
    setBusy(false);
    state.analyzing = false;
  }
}

function buildAlternatives(move, lines, playedScore) {
  const turn = move.beforeFen.split(" ")[1];
  const playedMoverScore = scoreForMover(playedScore, turn);
  const ranked = lines
    .filter((line) => line.uci && line.uci !== move.uci)
    .map((line) => ({
      ...line,
      san: uciToSan(move.beforeFen, line.uci),
      moverScore: scoreForMover(line.scoreWhite, turn),
    }))
    .filter((line) => line.san);

  const better = ranked.filter((line) => {
    if (playedMoverScore == null || line.moverScore == null) return true;
    return line.moverScore > playedMoverScore + 0.03;
  });

  const betterKeys = new Set(better.map((line) => line.uci));
  const fillers = ranked.filter((line) => !betterKeys.has(line.uci));
  return [...better, ...fillers].slice(0, 3);
}

function scoreForMover(scoreWhite, turn) {
  if (scoreWhite == null) return null;
  return turn === "w" ? scoreWhite : -scoreWhite;
}

function goToPly(ply) {
  state.currentPly = Math.max(0, Math.min(ply, state.moves.length));
  const chess = chessAtPly(state.currentPly);
  renderBoard(chess);
  renderMoveList();
  renderAnalysis();
  updateNavButtons();
}

function chessAtPly(ply) {
  const chess = new Chess();
  for (let index = 0; index < ply; index += 1) {
    const move = state.moves[index];
    if (!move) break;
    chess.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
  }
  return chess;
}

function renderBoard(chess) {
  const board = chess.board();
  const lastMove = state.currentPly > 0 ? state.moves[state.currentPly - 1] : null;
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const fragments = [];

  for (let rankIndex = 0; rankIndex < 8; rankIndex += 1) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      const squareName = `${files[fileIndex]}${8 - rankIndex}`;
      const piece = board[rankIndex][fileIndex];
      const color = (rankIndex + fileIndex) % 2 === 0 ? "light" : "dark";
      const lastClass = lastMove && (lastMove.from === squareName || lastMove.to === squareName) ? " last-move" : "";
      const rankLabel = fileIndex === 0 ? `<span class="coord rank">${8 - rankIndex}</span>` : "";
      const fileLabel = rankIndex === 7 ? `<span class="coord file">${files[fileIndex]}</span>` : "";
      const pieceText = piece ? PIECES[`${piece.color}${piece.type}`] : "";
      fragments.push(
        `<div class="square ${color}${lastClass}" data-square="${squareName}">${rankLabel}${fileLabel}<span aria-hidden="true">${pieceText}</span></div>`
      );
    }
  }

  els.board.innerHTML = fragments.join("");

  if (state.currentPly === 0) {
    els.boardCaption.textContent = "Starting position";
  } else {
    const move = state.moves[state.currentPly - 1];
    els.boardCaption.textContent = `${move.number}${move.side === "b" ? "..." : "."} ${move.san}`;
  }
}

function renderMoveList() {
  if (!state.moves.length) {
    els.moveList.innerHTML = `<div class="empty-state">No moves parsed.</div>`;
    return;
  }

  const rows = [];
  for (let index = 0; index < state.moves.length; index += 2) {
    const white = state.moves[index];
    const black = state.moves[index + 1];
    rows.push(`
      <div class="move-row">
        <div class="move-number">${white.number}.</div>
        ${renderMoveButton(white)}
        ${black ? renderMoveButton(black) : "<div></div>"}
      </div>
    `);
  }
  els.moveList.innerHTML = rows.join("");
  els.moveList.querySelectorAll("[data-ply]").forEach((button) => {
    button.addEventListener("click", () => goToPly(Number(button.dataset.ply)));
  });
}

function renderMoveButton(move) {
  const isCurrent = state.currentPly === move.ply ? " is-current" : "";
  const analyzed = state.analysis.has(move.ply) ? " data-analyzed='true'" : "";
  return `<button class="move-chip${isCurrent}" type="button" data-ply="${move.ply}"${analyzed}>${move.san}</button>`;
}

function renderAnalysis() {
  if (state.currentPly === 0) {
    els.positionMetric.textContent = "Start";
    els.playedMetric.textContent = "-";
    els.evalMetric.textContent = "-";
    els.alternativeList.innerHTML = `<div class="empty-state">Move to a parsed step to see its analysis.</div>`;
    return;
  }

  const move = state.moves[state.currentPly - 1];
  const analysis = state.analysis.get(move.ply);
  els.positionMetric.textContent = `${move.number}${move.side === "b" ? "..." : "."}`;
  els.playedMetric.textContent = move.san;
  els.evalMetric.textContent = analysis?.playedDisplay || "Waiting";

  if (!analysis) {
    els.alternativeList.innerHTML = `<div class="empty-state">Analyze this game to show Stockfish alternatives.</div>`;
    return;
  }

  if (!analysis.alternatives.length) {
    els.alternativeList.innerHTML = `<div class="empty-state">No stronger alternative found in the current MultiPV search.</div>`;
    return;
  }

  els.alternativeList.innerHTML = analysis.alternatives
    .map(
      (line) => `
      <div class="alternative">
        <div class="move">${line.san}</div>
        <div class="score">${line.displayScore}</div>
        <div class="pv" title="${escapeHtml(line.pvSan.join(" "))}">${line.pvSan.join(" ")}</div>
      </div>
    `
    )
    .join("");
}

function renderParseErrors() {
  if (!state.errors.length) {
    els.parseErrors.hidden = true;
    els.parseErrors.textContent = "";
    return;
  }

  const preview = state.errors.slice(0, 8).map((error) => error.token).join(", ");
  const more = state.errors.length > 8 ? `, plus ${state.errors.length - 8} more` : "";
  els.parseErrors.hidden = false;
  els.parseErrors.textContent = `Skipped ${state.errors.length} token(s): ${preview}${more}. You can edit the move text and parse again.`;
}

function updateNavButtons() {
  els.toStartButton.disabled = state.currentPly === 0;
  els.prevButton.disabled = state.currentPly === 0;
  els.nextButton.disabled = state.currentPly >= state.moves.length;
  els.toEndButton.disabled = state.currentPly >= state.moves.length;
}

function setBusy(isBusy, label = "") {
  els.ocrButton.disabled = isBusy || !state.imageFile;
  els.analyzeButton.disabled = isBusy;
  els.parseButton.disabled = isBusy;
  els.sampleButton.disabled = isBusy;
  if (label) setEngineStatus(label, isBusy);
}

function setEngineStatus(text, live = false) {
  els.engineStatus.textContent = text;
  els.engineStatus.classList.toggle("is-live", live);
}

function setLog(text) {
  els.logLine.textContent = text;
}

function setProgress(value) {
  els.progressFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function moveToUci(move) {
  return `${move.from}${move.to}${move.promotion || ""}`;
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return "";
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4, 5) || undefined,
    });
    return move?.san || "";
  } catch {
    return "";
  }
}

function pvToSan(fen, pvMoves) {
  const chess = new Chess(fen);
  const san = [];
  for (const uci of pvMoves.slice(0, 8)) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.slice(4, 5) || undefined,
      });
      if (!move) break;
      san.push(move.san);
    } catch {
      break;
    }
  }
  return san;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class StockfishClient {
  constructor() {
    this.worker = null;
    this.handlers = new Set();
  }

  async init() {
    this.worker = new Worker(stockfishWorkerUrl());

    this.worker.addEventListener("message", (event) => {
      const line = String(event.data || "");
      this.handlers.forEach((handler) => handler(line));
    });

    this.worker.addEventListener("error", (event) => {
      this.handlers.forEach((handler) => handler(`error ${event.message || "worker failed"}`));
    });

    this.post("uci");
    await this.waitFor((line) => line === "uciok", 12000, "Stockfish did not finish UCI setup.");
    this.post("isready");
    await this.waitFor((line) => line === "readyok", 12000, "Stockfish did not become ready.");
  }

  async analyze(fen, { depth, multipv, searchmoves = [] }) {
    this.post(`setoption name MultiPV value ${multipv}`);
    const ready = this.waitFor((line) => line === "readyok", 8000, "Stockfish was not ready.");
    this.post("isready");
    await ready;

    const lineMap = new Map();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        this.post("stop");
        reject(new Error("Stockfish analysis timed out."));
      }, Math.max(15000, depth * 4500));

      const handler = (line) => {
        if (line.startsWith("info ") && line.includes(" pv ")) {
          const parsed = parseEngineInfo(line, fen);
          if (parsed) lineMap.set(parsed.multipv, parsed);
        }

        if (line.startsWith("bestmove")) {
          cleanup();
          const lines = [...lineMap.values()].sort((a, b) => a.multipv - b.multipv);
          resolve({ fen, lines });
        }

        if (line.startsWith("error ")) {
          cleanup();
          reject(new Error(line.replace(/^error\s+/, "")));
        }
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        this.handlers.delete(handler);
      };

      this.handlers.add(handler);
      this.post(`position fen ${fen}`);
      const search = searchmoves.length ? ` searchmoves ${searchmoves.join(" ")}` : "";
      this.post(`go depth ${depth}${search}`);
    });
  }

  async analyzeTopMoves(fen, { depth, count }) {
    const legalMoves = new Chess(fen).moves({ verbose: true }).map(moveToUci);
    const remaining = new Set(legalMoves);
    const lines = [];

    while (lines.length < count && remaining.size) {
      const result = await this.analyze(fen, {
        depth,
        multipv: 1,
        searchmoves: [...remaining],
      });
      const [line] = result.lines;
      if (!line || !remaining.has(line.uci)) break;
      lines.push({ ...line, multipv: lines.length + 1 });
      remaining.delete(line.uci);
    }

    return lines;
  }

  waitFor(predicate, timeoutMs, message) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(message));
      }, timeoutMs);

      const handler = (line) => {
        if (predicate(line)) {
          cleanup();
          resolve(line);
        }
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        this.handlers.delete(handler);
      };

      this.handlers.add(handler);
    });
  }

  post(command) {
    this.worker?.postMessage(command);
  }
}

function stockfishWorkerUrl() {
  const wasmSupported =
    typeof WebAssembly === "object" &&
    typeof WebAssembly.validate === "function" &&
    WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));

  return wasmSupported ? STOCKFISH_SCRIPT : STOCKFISH_FALLBACK_SCRIPT;
}

function parseEngineInfo(line, fen) {
  const multipv = Number(line.match(/\bmultipv\s+(\d+)/)?.[1] || 1);
  const pvText = line.match(/\bpv\s+(.+)$/)?.[1] || "";
  const pv = pvText.split(/\s+/).filter(Boolean);
  if (!pv.length) return null;

  const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/);
  if (!scoreMatch) return null;

  const turn = fen.split(" ")[1];
  const scoreType = scoreMatch[1];
  const rawScore = Number(scoreMatch[2]);
  const scoreWhite = scoreType === "cp"
    ? (turn === "w" ? rawScore : -rawScore) / 100
    : mateToWhiteScore(rawScore, turn);

  return {
    multipv,
    uci: pv[0],
    pv,
    pvSan: pvToSan(fen, pv),
    scoreWhite,
    displayScore: scoreType === "cp" ? formatCp(scoreWhite) : formatMate(rawScore, turn),
  };
}

function mateToWhiteScore(mate, turn) {
  const whiteMate = turn === "w" ? mate : -mate;
  return whiteMate > 0 ? 1000 - whiteMate : -1000 - whiteMate;
}

function formatCp(scoreWhite) {
  if (scoreWhite == null) return "-";
  const sign = scoreWhite > 0 ? "+" : "";
  return `${sign}${scoreWhite.toFixed(2)}`;
}

function formatMate(mate, turn) {
  const whiteMate = turn === "w" ? mate : -mate;
  const sign = whiteMate > 0 ? "+" : "-";
  return `${sign}M${Math.abs(whiteMate)}`;
}
