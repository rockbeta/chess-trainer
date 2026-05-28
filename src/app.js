import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const STOCKFISH_SCRIPT =
  new URL("../vendor/stockfish/stockfish-18-lite-single.js", import.meta.url);
const STOCKFISH_FALLBACK_SCRIPT =
  new URL("../vendor/stockfish/stockfish-18-asm.js", import.meta.url);
const PADDLE_OCR_MODULE = "https://cdn.jsdelivr.net/npm/@paddleocr/paddleocr-js/+esm";
const ONNX_RUNTIME_WASM_PATH = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";
const OCR_WHITELIST = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZxXOolI-=+#. ";
const OCR_CONFUSIONS = new Map([
  ["0", "O"],
  ["O", "0"],
  ["o", "0"],
  ["I", "1"],
  ["l", "1"],
  ["|", "1"],
  ["S", "5"],
  ["s", "5"],
  ["Z", "2"],
  ["z", "2"],
  ["A", "4"],
  ["B", "8"],
  ["G", "6"],
  ["q", "g"],
  ["D", "0"],
  ["t", "1"],
  ["T", "7"],
  ["J", "1"],
  ["j", "1"],
  ["i", "1"],
  ["Q", "9"],
  ["g", "9"],
  ["b", "6"],
  ["E", "6"],
  ["C", "6"],
  ["d", "4"],
]);

// Maps OCR-confused digits back to chess piece letters (KQRBN).
const DIGIT_TO_PIECE = new Map([
  ["8", "B"],
  ["6", "G"],
  ["9", "Q"],
  ["1", "I"],
  ["5", "S"],
  ["2", "Z"],
]);

// Common swaps where a piece letter is misread as a digit or vice versa.
const PIECE_DIGIT_SWAPS = new Map([
  ["B", "8"],
  ["8", "B"],
  ["N", "N"],
  ["R", "R"],
  ["K", "K"],
  ["Q", "Q"],
  ["S", "5"],
  ["5", "S"],
  ["G", "6"],
  ["6", "G"],
  ["I", "1"],
  ["1", "I"],
  ["Z", "2"],
  ["2", "Z"],
  ["A", "4"],
  ["4", "A"],
  ["O", "0"],
  ["0", "O"],
  ["D", "0"],
  ["d", "4"],
]);

const PARSE_BEAM_WIDTH = 18;
const PARSE_MAX_TOKEN_GROUP = 3;
const PARSE_MOVE_REWARD = 7;
const PARSE_SKIP_PENALTY = 4;
const PARSE_GROUP_PENALTY = 0.22;

const SAMPLE_MOVES = `1. d4 c6 2. Nf3 d5 3. e3 e6 4. Bd3 c5 5. dxc5 Bxc5 6. Nbd2 Nc6 7. c3 Nge7 8. O-O Bd7 9. e4 O-O 10. exd5 Nxd5 11. Re1 Nf4 12. Bb1 Qg5 13. g3 Nh3+ 14. Kg2 Qh5 15. Qc2 Bxf2 16. Rf1 Be3 17. Ne4 Bxc1 18. Qxc1 Ne7 19. Nf2 Nxf2 20. Rxf2 Bc6 21. Kg1 Bxf3 22. Qe3 Bc6 23. Bd3 Rae8 24. Be2 Qd5 25. Bf3 Qb5 26. Qxa7 Bxf3 27. Rxf3 Qxb2 28. Raf1 Nd5 29. Qd4 Rc8 30. c4 Nf6 31. a4 Qxd4+`;

const LICHESS_PIECE_BASE =
  "https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett";

const ARROW_STYLES = {
  played: {
    className: "played-arrow",
    markerId: "arrow-head-played",
    color: "#2454a6",
  },
  alt1: {
    className: "alt-arrow alt-arrow-1",
    markerId: "arrow-head-alt-1",
    color: "#14795c",
  },
  alt2: {
    className: "alt-arrow alt-arrow-2",
    markerId: "arrow-head-alt-2",
    color: "#8a5a12",
  },
  alt3: {
    className: "alt-arrow alt-arrow-3",
    markerId: "arrow-head-alt-3",
    color: "#8b3f6d",
  },
};

const ARROW_LABEL_WIDTH = 21;
const ARROW_LABEL_HEIGHT = 6.2;

const state = {
  imageFile: null,
  moves: [],
  errors: [],
  currentPly: 0,
  analysis: new Map(),
  engine: null,
  paddleOcr: null,
  busy: false,
  analyzing: false,
  playMode: false,
  selectedSquare: null,
  playAnalysisTimer: null,
};

const els = {
  engineStatus: document.querySelector("#engineStatus"),
  imageInput: document.querySelector("#imageInput"),
  imagePreview: document.querySelector("#imagePreview"),
  previewWrap: document.querySelector("#previewWrap"),
  canvas: document.querySelector("#preprocessCanvas"),
  pgnText: document.querySelector("#pgnText"),
  skipHighlights: document.querySelector("#skipHighlights"),
  cleanupButton: document.querySelector("#cleanupButton"),
  pasteButton: document.querySelector("#pasteButton"),
  depthInput: document.querySelector("#depthInput"),
  depthValue: document.querySelector("#depthValue"),
  maxPliesInput: document.querySelector("#maxPliesInput"),
  analyzeButton: document.querySelector("#analyzeButton"),
  parseButton: document.querySelector("#parseButton"),
  progressFill: document.querySelector("#progressFill"),
  logLine: document.querySelector("#logLine"),
  parseErrors: document.querySelector("#parseErrors"),
  board: document.querySelector("#board"),
  boardCaption: document.querySelector("#boardCaption"),
  moveList: document.querySelector("#moveList"),
  playModeToggle: document.querySelector("#playModeToggle"),
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
  els.cleanupButton.addEventListener("click", cleanupTranscriptText);
  els.pasteButton.addEventListener("click", pasteClipboardText);
  els.pgnText.addEventListener("input", clearSkippedTokenHighlights);
  els.pgnText.addEventListener("scroll", syncSkippedTokenHighlights);
  els.analyzeButton.addEventListener("click", analyzeGame);
  els.parseButton.addEventListener("click", parseCurrentText);
  els.board.addEventListener("click", onBoardClick);
  els.playModeToggle.addEventListener("change", onPlayModeToggle);

  els.depthInput.addEventListener("input", () => {
    els.depthValue.value = els.depthInput.value;
  });

  els.toStartButton.addEventListener("click", () => goToPly(0));
  els.prevButton.addEventListener("click", () => goToPly(Math.max(0, state.currentPly - 1)));
  els.nextButton.addEventListener("click", () => goToPly(Math.min(state.moves.length, state.currentPly + 1)));
  els.toEndButton.addEventListener("click", () => goToPly(state.moves.length));
}

function cleanupTranscriptText() {
  const marker = "1. ";
  const markerIndex = els.pgnText.value.indexOf(marker);

  if (markerIndex === -1) {
    setLog(`Could not find "${marker}" in Move Text.`);
    return;
  }

  if (markerIndex === 0) {
    const parsed = parseCurrentText({ updateLog: false });
    setLog(`Move Text already starts with ${marker.trim()}. Parsed ${parsed.moves.length} moves.`);
    return;
  }

  els.pgnText.value = els.pgnText.value.slice(markerIndex);
  const parsed = parseCurrentText({ updateLog: false });

  if (parsed.moves.length) {
    setLog(`Cleaned transcript. Parsed ${parsed.moves.length} moves.`);
  } else {
    setLog("Cleaned transcript, but no legal moves parsed yet.");
  }
}

function onPlayModeToggle(event) {
  state.playMode = event.target.checked;
  state.selectedSquare = null;
  clearPendingPlayAnalysis();
  els.board.classList.toggle("is-play-mode", state.playMode);
  renderBoard(chessAtPly(state.currentPly));
  setLog(state.playMode ? "Play Mode on. Select a legal piece to move." : "Play Mode off.");
}

function onBoardClick(event) {
  if (!state.playMode) return;
  if (state.busy || state.playAnalysisTimer || state.analyzing) {
    setLog("Play Mode: wait for the current task to finish.");
    return;
  }

  const squareEl = event.target.closest("[data-square]");
  if (!squareEl || !els.board.contains(squareEl)) return;

  const square = squareEl.dataset.square;
  const chess = chessAtPly(state.currentPly);
  const piece = chess.get(square);

  if (!state.selectedSquare) {
    selectPlayableSquare(chess, square, piece);
    return;
  }

  if (state.selectedSquare === square) {
    state.selectedSquare = null;
    renderBoard(chess);
    return;
  }

  if (piece?.color === chess.turn()) {
    selectPlayableSquare(chess, square, piece);
    return;
  }

  commitPlayableMove(chess, state.selectedSquare, square);
}

function selectPlayableSquare(chess, square, piece) {
  if (!piece || piece.color !== chess.turn()) {
    const side = chess.turn() === "w" ? "white" : "black";
    setLog(`Play Mode: select a ${side} piece to move.`);
    return;
  }

  if (!legalTargetsForSquare(chess, square).size) {
    setLog("Play Mode: that piece has no legal moves.");
    return;
  }

  state.selectedSquare = square;
  renderBoard(chess);
}

function commitPlayableMove(chess, from, to) {
  const beforeFen = chess.fen();
  const candidate = { from, to };
  if (isPromotionMove(chess, from, to)) candidate.promotion = "q";

  let move = null;
  try {
    move = chess.move(candidate);
  } catch {
    move = null;
  }

  if (!move) {
    setLog("Illegal move. Choose a highlighted legal square.");
    return;
  }

  const nextPly = state.currentPly + 1;
  state.moves = state.moves.slice(0, state.currentPly);
  removeAnalysisFromPly(nextPly);
  state.moves.push(parsedMoveFromResolved(move, beforeFen, chess.fen(), nextPly, move.san));
  state.errors = [];
  state.currentPly = nextPly;
  state.selectedSquare = null;
  els.pgnText.value = formatParsedMoves(state.moves);
  clearParseErrors();

  renderBoard(chess);
  renderMoveList();
  renderAnalysis();
  updateNavButtons();
  schedulePlayMoveAnalysis(state.moves[state.moves.length - 1]);
}

function isPromotionMove(chess, from, to) {
  const piece = chess.get(from);
  if (piece?.type !== "p") return false;
  return (piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1");
}

function legalTargetsForSquare(chess, square) {
  return new Set(chess.moves({ square, verbose: true }).map((move) => move.to));
}

function removeAnalysisFromPly(startPly) {
  for (const ply of state.analysis.keys()) {
    if (ply >= startPly) state.analysis.delete(ply);
  }
}

async function pasteClipboardText() {
  if (!navigator.clipboard?.readText) {
    els.pgnText.focus();
    setLog("Clipboard read is unavailable here. Paste into Move Text manually.");
    return;
  }

  els.pasteButton.disabled = true;
  setLog("Reading clipboard...");

  try {
    const text = await navigator.clipboard.readText();
    const transcript = text.trim();

    if (!transcript) {
      setLog("Clipboard is empty.");
      return;
    }

    els.pgnText.value = transcript;
    const parsed = parseCurrentText({ updateLog: false });

    if (parsed.moves.length) {
      setLog(`Pasted clipboard transcript. Parsed ${parsed.moves.length} moves.`);
    } else {
      setLog("Pasted clipboard text, but no legal moves parsed yet.");
    }
  } catch (error) {
    setLog(`Could not read clipboard: ${error.message}`);
  } finally {
    els.pasteButton.disabled = false;
  }
}

function onImageSelected(event) {
  const [file] = event.target.files || [];
  state.imageFile = file || null;

  if (!state.imageFile) {
    els.previewWrap.classList.remove("has-image");
    els.imagePreview.removeAttribute("src");
    return;
  }

  els.imagePreview.src = URL.createObjectURL(state.imageFile);
  els.previewWrap.classList.add("has-image");
  clearParseErrors();
  setLog("Image ready. Running OCR automatically...");
  runOcr();
}

async function runOcr() {
  if (!state.imageFile) return;
  setBusy(true, "OCR running");
  setProgress(4);
  beginOcrRun();

  try {
    const results = [];
    const engine = "auto";

    if (engine === "paddle" || engine === "auto") {
      try {
        setLog("Loading PaddleOCR neural model.");
        results.push(await runPaddleOcr(state.imageFile));
        setProgress(engine === "auto" ? 46 : 88);
      } catch (error) {
        setLog(`PaddleOCR failed, falling back: ${error.message}`);
      }
    }

    if (engine === "tesseract" || engine === "auto" || !results.length) {
      results.push(...await runTesseractOcr(state.imageFile, engine === "auto" ? 46 : 10));
    }

    const best = pickBestOcrResult(results);
    els.pgnText.value = shouldUseCanonicalTranscript(best) ? formatParsedMoves(best.parsed.moves) : best.cleaned;
    setProgress(100);
    parseCurrentText({ updateLog: false });
    setLog(ocrSummary(best, results));
  } catch (error) {
    setLog(`OCR failed: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

async function runTesseractOcr(file, progressBase) {
  const sources = await buildOcrSources(file);
  const results = [];

  if (window.Tesseract?.createWorker) {
    const worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (message) => {
        if (message.status && !message.status.includes("recognizing")) {
          setLog(`OCR ${message.status}`);
        }
      },
    });

    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const passStart = progressBase + Math.round((index / sources.length) * 42);
      const passSize = Math.round(42 / sources.length);
      setLog(`OCR pass ${index + 1}/${sources.length}: ${source.name}`);
      await worker.setParameters(ocrParameters(source));
      const result = await worker.recognize(source.image);
      const scored = scoreOcrText(result.data.text || "", source.name);
      results.push(scored);
      setProgress(passStart + passSize);
    }

    await worker.terminate();
  } else if (window.Tesseract?.recognize) {
    const result = await window.Tesseract.recognize(file, "eng", {
      logger: (message) => {
        if (message.status === "recognizing text" && message.progress) {
          setProgress(progressBase + Math.round(message.progress * 42));
        }
      },
    });
    results.push(scoreOcrText(result.data.text || "", "Original"));
  } else {
    throw new Error("Tesseract.js did not load.");
  }

  return results;
}

async function runPaddleOcr(file) {
  if (!state.paddleOcr) {
    const { PaddleOCR } = await import(PADDLE_OCR_MODULE);
    state.paddleOcr = await PaddleOCR.create({
      textDetectionModelName: "PP-OCRv5_mobile_det",
      textRecognitionModelName: "PP-OCRv5_mobile_rec",
      ortOptions: {
        backend: "wasm",
        wasmPaths: ONNX_RUNTIME_WASM_PATH,
        numThreads: 1,
        simd: true,
      },
    });
  }

  const predictOpts = {
    textDetLimitSideLen: 2048,
    textRecScoreThresh: 0.3,
  };

  // Run on original image.
  setLog("Running PaddleOCR on original image.");
  const [origResult] = await state.paddleOcr.predict(file, predictOpts);
  const origItems = origResult?.items || [];
  const origText = orderOcrItems(origItems).map((item) => item.text).join(" ");
  const origScored = scoreOcrText(origText, "PaddleOCR neural");

  // Run multiple enhanced passes to catch all text brightness levels.
  // Chess.com has 3+ text brightness tiers on a dark background.
  const enhanceModes = ["chesscom", "chesscom-aggressive", "contrast-stretch"];
  const allResults = [origScored];
  let allItems = [...origItems];

  for (const mode of enhanceModes) {
    try {
      setLog(`Running PaddleOCR on ${mode} enhanced image.`);
      const enhanced = await preprocessImage(file, mode);
      const [enhResult] = await state.paddleOcr.predict(enhanced, predictOpts);
      const enhItems = enhResult?.items || [];
      const enhText = orderOcrItems(enhItems).map((item) => item.text).join(" ");
      const enhScored = scoreOcrText(enhText, `PaddleOCR neural (${mode})`);
      allResults.push(enhScored);
      allItems = mergeOcrItems(allItems, enhItems);
    } catch {
      // If this mode fails, continue with others.
    }
  }

  // Build a merged result from all detected text blocks across passes.
  const mergedText = orderOcrItems(allItems).map((item) => item.text).join(" ");
  const mergedScored = scoreOcrText(mergedText, "PaddleOCR neural (merged)");
  allResults.push(mergedScored);

  // Return the best scoring result from all passes.
  return pickBestOcrResult(allResults);
}

function orderOcrItems(items) {
  return [...items].sort((left, right) => {
    const leftCenter = ocrItemCenter(left);
    const rightCenter = ocrItemCenter(right);
    const lineTolerance = Math.max(leftCenter.height, rightCenter.height, 18) * 0.7;

    if (Math.abs(leftCenter.y - rightCenter.y) > lineTolerance) {
      return leftCenter.y - rightCenter.y;
    }

    return leftCenter.x - rightCenter.x;
  });
}

function ocrItemCenter(item) {
  const points = item.poly || item.box || [];
  const xs = points.map((point) => Array.isArray(point) ? point[0] : point.x).filter(Number.isFinite);
  const ys = points.map((point) => Array.isArray(point) ? point[1] : point.y).filter(Number.isFinite);

  if (!xs.length || !ys.length) {
    return { x: 0, y: 0, height: 18 };
  }

  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    height: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Merge OCR items from two passes, deduplicating based on spatial overlap.
 * If a new item overlaps an existing one, keep the one with more text.
 * New items that don't overlap anything are appended (they represent text
 * that was only detected in the new pass, e.g. dim gray text).
 */
function mergeOcrItems(existing, incoming) {
  const merged = [...existing];

  for (const newItem of incoming) {
    const newCenter = ocrItemCenter(newItem);
    let foundOverlap = false;

    for (let i = 0; i < merged.length; i++) {
      const existingCenter = ocrItemCenter(merged[i]);
      const tolerance = Math.max(existingCenter.height, newCenter.height, 18) * 0.6;

      if (
        Math.abs(existingCenter.y - newCenter.y) < tolerance &&
        Math.abs(existingCenter.x - newCenter.x) < tolerance * 1.5
      ) {
        // Overlapping region — keep the one with more recognized text.
        if ((newItem.text || "").length > (merged[i].text || "").length) {
          merged[i] = newItem;
        }
        foundOverlap = true;
        break;
      }
    }

    if (!foundOverlap) {
      // This text block was only detected in the new pass (dim text).
      merged.push(newItem);
    }
  }

  return merged;
}

function ocrParameters(source) {
  const params = {
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: String(source.psm),
    user_defined_dpi: "300",
  };

  if (source.whitelist) {
    params.tessedit_char_whitelist = OCR_WHITELIST;
  }

  return params;
}

async function buildOcrSources(file) {
  return [
    { name: "original screenshot", image: file, psm: 6, whitelist: true },
    { name: "original screenshot, open alphabet", image: file, psm: 6, whitelist: false },
    { name: "high contrast text", image: await preprocessImage(file, "binary"), psm: 6, whitelist: true },
    { name: "chess.com optimized", image: await preprocessImage(file, "chesscom"), psm: 6, whitelist: true },
    { name: "chess.com aggressive", image: await preprocessImage(file, "chesscom-aggressive"), psm: 6, whitelist: true },
    { name: "contrast stretched", image: await preprocessImage(file, "contrast-stretch"), psm: 6, whitelist: true },
    { name: "soft contrast text", image: await preprocessImage(file, "grayscale"), psm: 6, whitelist: true },
  ];
}

function scoreOcrText(text, source) {
  const cleaned = cleanMoveText(text);
  const parsed = parseMoves(cleaned);
  const moveNumberCount = (cleaned.match(/\b\d{1,3}\s*\./g) || []).length;
  const highestMoveNumber = highestMoveNumberInText(cleaned);
  const expectedPlies = highestMoveNumber ? highestMoveNumber * 2 : 0;
  const tokenCount = tokenizeMoves(cleaned).length;
  const skippedCount = parsed.errors.length;
  const missingExpectedMoves = Math.max(0, expectedPlies - parsed.moves.length);
  const score =
    parsed.moves.length * 24 +
    moveNumberCount * 3 -
    skippedCount * 12 -
    missingExpectedMoves * 14 -
    Math.max(0, tokenCount - parsed.moves.length - skippedCount);

  return {
    source,
    text,
    cleaned,
    parsed,
    expectedPlies,
    score,
  };
}

function highestMoveNumberInText(text) {
  return Math.max(0, ...[...text.matchAll(/\b(\d{1,3})\s*\./g)].map((match) => Number(match[1])));
}

function shouldUseCanonicalTranscript(result) {
  if (!result.parsed.moves.length) return false;
  if (!result.expectedPlies) return result.parsed.errors.length === 0;

  const enoughMoves = result.parsed.moves.length >= result.expectedPlies - 1;
  const lowNoise = result.parsed.errors.length <= 2;
  return enoughMoves && lowNoise;
}

function pickBestOcrResult(results) {
  if (!results.length) {
    throw new Error("No OCR result was produced.");
  }

  return [...results].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.parsed.moves.length !== a.parsed.moves.length) return b.parsed.moves.length - a.parsed.moves.length;
    return a.cleaned.length - b.cleaned.length;
  })[0];
}

function formatParsedMoves(moves) {
  const pairs = [];

  for (let index = 0; index < moves.length; index += 2) {
    const white = moves[index];
    const black = moves[index + 1];
    pairs.push(`${white.number}. ${white.san}${black ? ` ${black.san}` : ""}`);
  }

  return pairs.join(" ");
}

function beginOcrRun() {
  state.errors = [];
  state.analysis.clear();
  clearParseErrors();
  renderAnalysis();
  setLog(`Running OCR with Best of both.`);
}

function clearParseErrors() {
  els.parseErrors.hidden = true;
  els.parseErrors.textContent = "";
  clearSkippedTokenHighlights();
}

function ocrSummary(best, results) {
  const skipped = best.parsed.errors.length;
  const expected = best.expectedPlies ? ` of about ${best.expectedPlies}` : "";
  const alternateCount = Math.max(0, results.length - 1);
  const fallback = alternateCount ? ` Compared ${results.length} OCR result${results.length === 1 ? "" : "s"}.` : "";
  return `OCR complete using ${best.source}. Parsed ${best.parsed.moves.length}${expected} legal moves; skipped ${skipped} token${skipped === 1 ? "" : "s"}.${fallback}`;
}

async function preprocessImage(file, mode) {
  const bitmap = await createImageBitmap(file);
  const targetWidth = 2400;
  const scale = Math.min(2.6, Math.max(1, targetWidth / bitmap.width));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = els.canvas;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  const data = context.getImageData(0, 0, width, height);
  const stats = imageLuminosityStats(data, width, height);
  const darkBackground = stats.borderAverage < 128;
  const threshold = darkBackground
    ? Math.max(stats.borderAverage + 24, stats.otsu - 18)
    : Math.min(stats.borderAverage - 24, stats.otsu + 18);

  // Chess.com-specific threshold: very low to catch even the dimmest gray text.
  // Chess.com move lists have bright white, medium white, and gray text on a dark bg.
  const chesscomThreshold = darkBackground
    ? Math.max(stats.borderAverage + 8, stats.p05 + 14)
    : Math.min(stats.borderAverage - 8, stats.p95 - 14);

  // Even more aggressive threshold to capture the very dimmest text.
  const aggressiveThreshold = darkBackground
    ? Math.max(stats.borderAverage + 4, stats.p05 + 8)
    : Math.min(stats.borderAverage - 4, stats.p95 - 8);

  for (let index = 0; index < data.data.length; index += 4) {
    const r = data.data[index];
    const g = data.data[index + 1];
    const b = data.data[index + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    let output;

    if (mode === "chesscom") {
      // Ultra-aggressive: any pixel above the dark background becomes foreground.
      const foreground = darkBackground ? gray >= chesscomThreshold : gray <= chesscomThreshold;
      output = foreground ? 0 : 255;
    } else if (mode === "chesscom-aggressive") {
      // Extreme threshold to catch the very dimmest gray text.
      const foreground = darkBackground ? gray >= aggressiveThreshold : gray <= aggressiveThreshold;
      output = foreground ? 0 : 255;
    } else if (mode === "contrast-stretch") {
      // Stretch all text to uniform black on white, preserving details.
      // This helps OCR by making dim and bright text equally readable.
      output = contrastStretchPixel(gray, stats, darkBackground);
    } else if (mode === "binary") {
      const foreground = darkBackground ? gray >= threshold : gray <= threshold;
      output = foreground ? 0 : 255;
    } else {
      output = normalizeTextPixel(gray, stats, darkBackground);
    }

    data.data[index] = output;
    data.data[index + 1] = output;
    data.data[index + 2] = output;
    data.data[index + 3] = 255;
  }
  context.putImageData(data, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare image for OCR."));
    }, "image/png");
  });
}

function imageLuminosityStats(imageData, width, height) {
  const histogram = new Array(256).fill(0);
  let borderTotal = 0;
  let borderCount = 0;
  const borderSize = Math.max(1, Math.floor(Math.min(width, height) * 0.04));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const gray = Math.round(
        0.299 * imageData.data[offset] +
        0.587 * imageData.data[offset + 1] +
        0.114 * imageData.data[offset + 2]
      );
      histogram[gray] += 1;

      if (x < borderSize || x >= width - borderSize || y < borderSize || y >= height - borderSize) {
        borderTotal += gray;
        borderCount += 1;
      }
    }
  }

  return {
    borderAverage: borderTotal / Math.max(1, borderCount),
    otsu: otsuThreshold(histogram, width * height),
    p05: histogramPercentile(histogram, 0.05),
    p95: histogramPercentile(histogram, 0.95),
  };
}

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    sum += value * histogram[value];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = 0;
  let threshold = 128;

  for (let value = 0; value < histogram.length; value += 1) {
    weightBackground += histogram[value];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += value * histogram[value];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }

  return threshold;
}

function histogramPercentile(histogram, percentile) {
  const target = histogram.reduce((total, count) => total + count, 0) * percentile;
  let running = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    running += histogram[value];
    if (running >= target) return value;
  }

  return histogram.length - 1;
}

function normalizeTextPixel(gray, stats, darkBackground) {
  const low = stats.p05;
  const high = Math.max(stats.p95, low + 1);
  const normalized = clamp((gray - low) / (high - low), 0, 1);
  const ink = darkBackground ? 1 - normalized : normalized;
  const boosted = ink < 0.5 ? ink * 0.62 : 1 - (1 - ink) * 0.42;
  return Math.round(clamp(boosted, 0, 1) * 255);
}

/**
 * Contrast-stretch pixel for multi-brightness text on a uniform background.
 * Uses a sigmoid curve to push all "foreground" grays toward black while
 * keeping the background white. This captures dim, medium, and bright text
 * with good legibility for OCR.
 */
function contrastStretchPixel(gray, stats, darkBackground) {
  const bgLevel = stats.borderAverage;
  // Distance from background, normalized.
  const distance = darkBackground ? gray - bgLevel : bgLevel - gray;
  // Anything close to background is background.
  if (distance < 4) return 255;
  // Stretch: map small distances (dim text) and large distances (bright text) all toward black.
  const maxDistance = darkBackground ? (255 - bgLevel) : bgLevel;
  const ratio = clamp(distance / Math.max(maxDistance, 1), 0, 1);
  // Power curve: 0.35 exponent aggressively boosts dim text (low ratio) toward black.
  // Even ratio=0.05 (very dim text) → 0.05^0.35 ≈ 0.29 → pixel ≈ 181 (visible gray).
  const ink = Math.pow(ratio, 0.35);
  return Math.round(clamp(1 - ink, 0, 1) * 255);
}

function parseCurrentText({ updateLog = true } = {}) {
  const result = parseMoves(els.pgnText.value);
  state.moves = result.moves;
  state.errors = result.errors;
  state.selectedSquare = null;
  state.analysis.clear();
  state.currentPly = Math.min(state.currentPly, state.moves.length);

  renderMoveList();
  goToPly(state.currentPly);
  renderParseErrors();
  renderSkippedTokenHighlights(state.errors);

  if (updateLog) {
    if (state.moves.length) {
      setLog(`Parsed ${state.moves.length} moves. Ready to analyze.`);
    } else {
      setLog("No legal moves parsed yet.");
    }
  }

  return result;
}

function parseMoves(rawText) {
  const tokens = tokenizeMoves(cleanMoveText(rawText));
  const chess = new Chess();
  let beam = [
    {
      index: 0,
      fen: chess.fen(),
      moves: [],
      errors: [],
      cost: 0,
      skippedInRow: 0,
    },
  ];

  for (let step = 0; step < tokens.length; step += 1) {
    const expanded = [];

    for (const state of beam) {
      expanded.push(...advanceParseState(state, tokens));
    }

    beam = pruneParseBeam(expanded);
    if (beam.every((state) => state.index >= tokens.length)) break;
  }

  const best = pickBestParseState(beam);
  return { moves: best.moves, errors: best.errors };
}

function advanceParseState(state, tokens) {
  if (state.index >= tokens.length) return [state];

  const states = [];
  const maxGroupLength = Math.min(PARSE_MAX_TOKEN_GROUP, tokens.length - state.index);

  for (let length = 1; length <= maxGroupLength; length += 1) {
    const tokenGroup = tokens.slice(state.index, state.index + length);
    const rawToken = tokenGroup.join("");
    const chess = new Chess(state.fen);
    const beforeFen = chess.fen();
    const resolved = resolveMoveToken(chess, rawToken);

    if (!resolved.move) continue;

    const move = resolved.move;
    const afterFen = chess.fen();
    const groupPenalty = (length - 1) * PARSE_GROUP_PENALTY;
    states.push({
      index: state.index + length,
      fen: afterFen,
      moves: [
        ...state.moves,
        parsedMoveFromResolved(move, beforeFen, afterFen, state.moves.length + 1, resolved.usedToken),
      ],
      errors: state.errors,
      cost: state.cost + resolved.cost + groupPenalty - PARSE_MOVE_REWARD,
      skippedInRow: 0,
    });
  }

  states.push({
    ...state,
    index: state.index + 1,
    errors: [...state.errors, { token: tokens[state.index], fen: state.fen }],
    cost: state.cost + skipTokenCost(tokens[state.index], state.skippedInRow),
    skippedInRow: state.skippedInRow + 1,
  });

  return states;
}

function parsedMoveFromResolved(move, beforeFen, afterFen, ply, usedToken) {
  return {
    ply,
    number: Math.ceil(ply / 2),
    side: move.color,
    beforeFen,
    afterFen,
    san: move.san,
    input: usedToken,
    uci: moveToUci(move),
    from: move.from,
    to: move.to,
    promotion: move.promotion || "",
  };
}

function skipTokenCost(token, skippedInRow) {
  const repeatedSkipPenalty = Math.min(1.5, skippedInRow * 0.35);
  if (/^\d{1,3}$/.test(token)) return 1.4 + repeatedSkipPenalty;
  if (/^[A-Z][a-z]{3,}$/.test(token)) return 2.1 + repeatedSkipPenalty;
  return PARSE_SKIP_PENALTY + repeatedSkipPenalty;
}

function pruneParseBeam(states) {
  const bestByPosition = new Map();

  for (const state of states) {
    const key = `${state.index}|${state.fen}`;
    const existing = bestByPosition.get(key);
    if (!existing || compareParseStates(state, existing) < 0) {
      bestByPosition.set(key, state);
    }
  }

  return [...bestByPosition.values()].sort(compareParseStates).slice(0, PARSE_BEAM_WIDTH);
}

function pickBestParseState(states) {
  return [...states].sort(compareParseStates)[0] || {
    moves: [],
    errors: [],
  };
}

function compareParseStates(left, right) {
  if (left.cost !== right.cost) return left.cost - right.cost;
  if (left.moves.length !== right.moves.length) return right.moves.length - left.moves.length;
  if (left.errors.length !== right.errors.length) return left.errors.length - right.errors.length;
  return right.index - left.index;
}

function cleanMoveText(input) {
  return input
    .normalize("NFKC")
    // Normalize Unicode punctuation and lookalikes.
    .replace(/[|]/g, "I")
    .replace(/[×✕✖]/g, "x")
    .replace(/[–—−‐‑]/g, "-")
    .replace(/[''`´]/g, "'")
    .replace(/[""„]/g, '"')
    .replace(/[□■▪▫◻◼⬜⬛[\]【】]/g, " ")
    // Fix merged move-number + move: "19Na4" → "19. Na4", "3Nc3" → "3. Nc3"
    .replace(/\b(\d{1,3})([KQRBNOP][a-h])/g, "$1. $2")
    .replace(/\b(\d{1,3})([a-h][x1-8])/g, "$1. $2")
    // Fix merged move-number + castling: "22O-O-O" → "22. O-O-O", "8O-O" → "8. O-O"
    .replace(/\b(\d{1,3})\.?\s*([oO0]-[oO0](?:-[oO0])?)/g, "$1. $2")
    // Normalize castling — generous pattern matching.
    .replace(/[o0]\s*-\s*[o0]\s*-\s*[o0]/gi, "O-O-O")
    .replace(/[o0]\s*-\s*[o0]/gi, "O-O")
    .replace(/\bOOO\b/gi, "O-O-O")
    .replace(/\bOO\b/gi, "O-O")
    .replace(/\b0-0-0\b/g, "O-O-O")
    .replace(/\b0-0\b/g, "O-O")
    // Fix commas misread as dots in move numbers: "19, Na4" → "19. Na4".
    .replace(/(\d{1,3})\s*,\s*(?=[KQRBNa-hO])/g, "$1. ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMoves(text) {
  const raw = text
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\{[^}]*}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\d+\s*\.\s*\.\./g, " ")
    .replace(/\b\d+\s*[.,:]?\s*/g, " ")
    .replace(/\b(?:1-0|0-1|1\/2-1\/2|\*)\b/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^[+#=.,:;-]+$/.test(token))
    .filter((token) => !/^(?:Options|Explore|Back|Forward|Review|Analysis|Accuracy|Game|New|Retry|Share)$/i.test(token));

  // Split merged tokens: e.g. "Na4b3" → ["Na4", "b3"], "cxb6axb6" → ["cxb6", "axb6"]
  const split = [];
  for (const token of raw) {
    const parts = splitMergedMoves(token);
    split.push(...parts);
  }

  return split;
}

/**
 * Detects and splits a token that looks like two chess moves merged together.
 * Common chess.com OCR artifact when spacing is tight.
 * Examples: "Na4b3" → ["Na4","b3"], "Bxg6Qxg6" → ["Bxg6","Qxg6"],
 *           "cxb6axb6" → ["cxb6","axb6"], "Rfc8+Bxe2" → ["Rfc8+","Bxe2"]
 */
function splitMergedMoves(token) {
  // Don't split short tokens or castling.
  if (token.length <= 4 || /^O-O/i.test(token)) return [token];

  // Pattern: after a valid-looking move-end (file+rank, optionally +/#),
  // if another move starts (piece letter or pawn file), split there.
  const splitPattern = /^((?:[KQRBN]?[a-h]?x?[a-h][1-8](?:=[QRBN])?[+#]?)|(?:O-O(?:-O)?[+#]?))([KQRBNa-h].+)$/;
  const match = token.match(splitPattern);
  if (match) {
    const first = match[1];
    const rest = match[2];
    // Recursively split the rest in case of triple merge.
    return [first, ...splitMergedMoves(rest)];
  }

  return [token];
}

function resolveMoveToken(chess, token) {
  const repaired = repairMoveToken(token);
  const candidates = buildMoveCandidates(repaired);

  for (const candidate of candidates) {
    try {
      const move = chess.move(candidate, { strict: false });
      if (!move) continue;

      return {
        move,
        usedToken: candidate,
        cost: resolvedMoveCost(token, repaired, candidate, move.san),
      };
    } catch {
      // Keep trying chess-specific repairs below.
    }
  }

  const legal = chess.moves({ verbose: true });
  const fuzzy = findClosestLegalMove(repaired, legal);
  if (!fuzzy) {
    return { move: null, usedToken: repaired };
  }

  const move = chess.move(fuzzy.move.san, { strict: false });
  if (!move) {
    return { move: null, usedToken: repaired };
  }

  return {
    move,
    usedToken: fuzzy.move.san,
    cost: fuzzy.distance + 0.35,
  };
}

function resolvedMoveCost(original, repaired, candidate, san) {
  const candidateCost = bestMoveDistance(moveForms(repaired), moveForms(candidate));
  const sanCost = bestMoveDistance(moveForms(repaired), moveForms(san));
  const repairCost = original === repaired
    ? 0
    : Math.min(0.35, bestMoveDistance(moveForms(original), moveForms(repaired)) * 0.2);

  return Math.min(1.5, Math.min(candidateCost, sanCost) + repairCost);
}

function repairMoveToken(token) {
  let repaired = token
    .replace(/[^a-zA-Z0-9xX=+#\-]/g, "")
    .replace(/[,:;]+$/g, "");

  // Castling normalization.
  if (/^[o0][- ]?[o0]([- ]?[o0])?[+#]?$/i.test(repaired)) {
    const suffix = repaired.endsWith("+") || repaired.endsWith("#") ? repaired.slice(-1) : "";
    const core = repaired.replace(/[+#]/g, "").replace(/[o0]/gi, "O").replace(/\s+/g, "-");
    return core.length > 3 ? `O-O-O${suffix}` : `O-O${suffix}`;
  }

  // Remove doubled piece-prefix OCR stutter: "NNa4" → "Na4", "BBxg6" → "Bxg6".
  repaired = repaired.replace(/^([KQRBN])\1+/, "$1");

  // Remove spurious dashes inside moves: "Na-4" → "Na4", "Bx-g6" → "Bxg6".
  repaired = repaired.replace(/^([KQRBN]?[a-h]?x?)[-]([a-h][1-8])/, "$1$2");

  // Fix digit/file swap: "N4a" → "Na4" (OCR swapped position of file and rank).
  repaired = repaired.replace(/^([KQRBN])([1-8])([a-h])([+#]?)$/, "$1$3$2$4");

  // Fix "I"/"l" as rank 1 in all move patterns.
  repaired = repaired.replace(/([a-h])([Il])([+#]?)$/g, "$11$3");
  repaired = repaired.replace(/([KQRBN])([a-h])([Il])([+#]?)$/g, "$1$21$4");
  repaired = repaired.replace(/([a-h])x([a-h])([Il])([+#]?)$/g, "$1x$21$4");
  repaired = repaired.replace(/([KQRBN])x([a-h])([Il])([+#]?)$/g, "$1x$21$4");

  // Fix disambiguated piece moves with "I"/"l" as rank: "R1c8" → works, "RIc8" → "R1c8".
  repaired = repaired.replace(/^([KQRBN])([Il])([a-h][1-8])([+#]?)$/g, "$11$3$4");
  repaired = repaired.replace(/^([KQRBN])([Il])x([a-h][1-8])([+#]?)$/g, "$11x$3$4");

  // Fix trailing "O" misread as "0" after a file letter: "a0" → valid? only if no "aO" move.
  repaired = repaired.replace(/([a-h])O([+#]?)$/g, "$10$2");

  // Expanded rank confusion: handle all commonly confused characters in rank position.
  repaired = repaired.replace(/x([a-h])([AIlSGEDTtJjd])([+#]?)$/g, (_match, file, rank, suffix) => `x${file}${ocrRank(rank)}${suffix}`);
  repaired = repaired.replace(/([a-h])([AIlSGEDTtJjd])([+#]?)$/g, (_match, file, rank, suffix) => `${file}${ocrRank(rank)}${suffix}`);

  // Fix leading digit that should be a piece letter: "8xg6" → "Bxg6".
  repaired = repaired.replace(/^([0-9])(x?[a-h][1-8])([+#]?)$/, (_match, digit, rest, suffix) => {
    const piece = DIGIT_TO_PIECE.get(digit);
    return piece ? `${piece}${rest}${suffix}` : `${digit}${rest}${suffix}`;
  });

  // Fix disambiguated piece move with leading digit: "8fc8" → "Bfc8" (unlikely but safe).
  repaired = repaired.replace(/^([0-9])([a-h])(x?)([a-h][1-8])([+#]?)$/, (_match, digit, disambig, capture, target, suffix) => {
    const piece = DIGIT_TO_PIECE.get(digit);
    return piece ? `${piece}${disambig}${capture}${target}${suffix}` : `${digit}${disambig}${capture}${target}${suffix}`;
  });

  // Fix trailing garbage after a valid-looking move.
  repaired = repaired.replace(/^([KQRBN]?[a-h]?x?[a-h][1-8](?:=[QRBN])?[+#]?)[a-zA-Z]{2,}$/, "$1");

  // Fix disambiguated piece move trailing garbage: "Rfc8xyz" → "Rfc8".
  repaired = repaired.replace(/^([KQRBN][a-h][a-h][1-8](?:=[QRBN])?[+#]?)[a-zA-Z]{2,}$/, "$1");

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

  // Try swapping leading character with piece-letter if it looks like a digit confusion.
  // e.g., "8xg6" → "Bxg6", "6f3" → "Gf3" (not valid, but covered by fuzzy).
  if (/^[0-9]/.test(token)) {
    const piece = DIGIT_TO_PIECE.get(token[0]);
    if (piece) candidates.add(piece + token.slice(1));
  }

  // Try all KQRBN if the first character is wrong — "Hxg6" → "Bxg6", "Nxg6" etc.
  if (/^[A-Z]/.test(token) && !/^[KQRBN]/.test(token)) {
    for (const piece of ["K", "Q", "R", "B", "N"]) {
      candidates.add(piece + token.slice(1));
    }
  }

  // Try lowercase piece normalization: "na4" → "Na4", "rfc8" → "Rfc8".
  if (/^[kqrbn]/.test(token)) {
    candidates.add(token[0].toUpperCase() + token.slice(1));
  }

  // Normalize uppercase X to lowercase x (capture): "NXg6" → "Nxg6".
  if (/X/.test(token)) {
    candidates.add(token.replace(/X/g, "x"));
  }

  // Try inserting 'x' for captures: "Bg6" → "Bxg6" when a capture was intended.
  const captureInsert = token.match(/^([KQRBN])([a-h])([1-8])([+#]?)$/);
  if (captureInsert) {
    candidates.add(`${captureInsert[1]}x${captureInsert[2]}${captureInsert[3]}${captureInsert[4]}`);
  }

  // Pawn capture insert: "bg6" → "bxg6".
  const pawnCaptureInsert = token.match(/^([a-h])([a-h])([1-8])([+#]?)$/);
  if (pawnCaptureInsert && pawnCaptureInsert[1] !== pawnCaptureInsert[2]) {
    candidates.add(`${pawnCaptureInsert[1]}x${pawnCaptureInsert[2]}${pawnCaptureInsert[3]}${pawnCaptureInsert[4]}`);
  }

  // Handle trailing 't' as '+' (OCR misread): "Rfc8t" → "Rfc8+".
  if (/t$/.test(token)) {
    candidates.add(token.slice(0, -1) + "+");
    candidates.add(token.slice(0, -1));
  }

  // Try each character substitution from OCR confusions (single-character swaps).
  for (let i = 0; i < token.length && i < 6; i++) {
    const swap = PIECE_DIGIT_SWAPS.get(token[i]);
    if (swap && swap !== token[i]) {
      candidates.add(token.slice(0, i) + swap + token.slice(i + 1));
    }
  }

  for (const candidate of [...candidates]) {
    const suffix = candidate.match(/[+#]$/)?.[0] || "";
    const body = suffix ? candidate.slice(0, -1) : candidate;
    candidates.add(`${body.replace(/([a-h][1-8])[a-zA-Z]+$/, "$1")}${suffix}`);
    candidates.add(`${body.replace(/([KQRBN]?)([a-h1-8]{0,2})x([a-h])[a-zA-Z]+$/, "$1$2x$3")}${suffix}`);
  }

  return [...candidates].filter(Boolean);
}

function ocrRank(value) {
  const rank = OCR_CONFUSIONS.get(value) || value;
  return /^[1-8]$/.test(rank) ? rank : value;
}

function normalizeSanForCompare(san) {
  return san
    .replace(/[+#?!]/g, "")
    .replace(/0/g, "O")
    .replace(/[Il]/g, "1");
}

function findClosestLegalMove(token, legalMoves) {
  const tokenForms = moveForms(token);
  const scored = legalMoves
    .flatMap((move) =>
      moveForms(move.san).map((form) => ({
        move,
        distance: bestMoveDistance(tokenForms, [form]),
      }))
    )
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  if (!best) return null;

  const nextDifferent = scored.find((entry) => entry.move.san !== best.move.san);
  const bestLength = Math.max(2, moveKey(best.move.san).length);
  // Slightly more generous limit so OCR confusions like piece swaps pass through.
  const limit = Math.max(0.85, Math.min(2.0, bestLength * 0.32));
  // Accept a match if it's clearly the best, even with a small margin.
  const clearMargin = !nextDifferent || nextDifferent.distance - best.distance >= 0.18;

  if (best.distance <= limit && clearMargin) {
    return {
      move: best.move,
      distance: best.distance,
      margin: nextDifferent ? nextDifferent.distance - best.distance : Infinity,
    };
  }

  return null;
}

function bestMoveDistance(leftForms, rightForms) {
  let best = Infinity;

  for (const left of leftForms) {
    for (const right of rightForms) {
      best = Math.min(best, weightedEditDistance(left, right));
    }
  }

  return best;
}

function moveForms(value) {
  const key = moveKey(value);
  const forms = new Set([key, key.replace(/x/g, "")]);

  if (/^O-O/.test(key)) {
    forms.add(key.replace(/-/g, ""));
  }

  const disambiguated = key.match(/^([KQRBN])([a-h1-8]{1,2})(x?)([a-h][1-8])(=?[QRBN])?$/);
  if (disambiguated) {
    forms.add(`${disambiguated[1]}${disambiguated[3]}${disambiguated[4]}${disambiguated[5] || ""}`);
    forms.add(`${disambiguated[1]}${disambiguated[4]}${disambiguated[5] || ""}`);
    forms.add(`${disambiguated[1]}${disambiguated[3]}${disambiguated[4][0]}`);
  }

  const targetSquare = key.match(/^([KQRBN]?)([a-h1-8]{0,2})(x?)([a-h])([1-8])([a-zA-Z]+)$/);
  if (targetSquare) {
    forms.add(`${targetSquare[1]}${targetSquare[2]}${targetSquare[3]}${targetSquare[4]}${targetSquare[5]}`);
    forms.add(`${targetSquare[1]}${targetSquare[2]}${targetSquare[3]}${targetSquare[4]}`);
  }

  const targetFileOnly = key.match(/^([KQRBN]?)([a-h1-8]{0,2})(x)([a-h])[a-zA-Z]$/);
  if (targetFileOnly) {
    forms.add(`${targetFileOnly[1]}${targetFileOnly[2]}${targetFileOnly[3]}${targetFileOnly[4]}`);
  }

  return [...forms].filter(Boolean);
}

function moveKey(value) {
  return value
    .normalize("NFKC")
    .replace(/[+#?!]/g, "")
    .replace(/[×]/g, "x")
    .replace(/[o0]/gi, "O")
    .replace(/[Il|]/g, "1")
    .replace(/S/g, "5")
    .replace(/Z/g, "2")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9x=+\-]/g, "");
}

function weightedEditDistance(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) dp[row][0] = row;
  for (let column = 0; column < columns; column += 1) dp[0][column] = column;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitution = characterDistance(left[row - 1], right[column - 1]);
      dp[row][column] = Math.min(
        dp[row - 1][column] + deletionCost(left[row - 1]),
        dp[row][column - 1] + deletionCost(right[column - 1]),
        dp[row - 1][column - 1] + substitution
      );
    }
  }

  return dp[left.length][right.length];
}

function characterDistance(left, right) {
  if (left === right) return 0;
  if (left.toLowerCase() === right.toLowerCase()) return 0.08;
  if (OCR_CONFUSIONS.get(left) === right || OCR_CONFUSIONS.get(right) === left) return 0.18;
  return 1;
}

function deletionCost(char) {
  return char === "x" || char === "-" || char === "=" ? 0.35 : 1;
}

async function analyzeGame() {
  if (state.analyzing) return;
  clearPendingPlayAnalysis();

  const parsed = parseCurrentText();
  if (!parsed.moves.length) return;

  state.analyzing = true;
  setBusy(true, "Engine running");
  setEngineStatus("Engine loading", true);
  setProgress(0);

  try {
    await ensureEngineReady();

    const depth = Number(els.depthInput.value);
    const maxPlies = Math.min(Number(els.maxPliesInput.value) || parsed.moves.length, parsed.moves.length);

    for (let index = 0; index < maxPlies; index += 1) {
      const move = parsed.moves[index];
      setLog(`Analyzing ${move.number}${move.side === "b" ? "..." : "."} ${move.san}`);
      setEngineStatus(`Analyzing ${index + 1}/${maxPlies}`, true);
      setProgress(Math.round((index / maxPlies) * 100));

      state.analysis.set(move.ply, await analyzeSingleMove(move, depth));

      if (state.currentPly === move.ply) {
        renderBoard(chessAtPly(state.currentPly));
        renderAnalysis();
      }
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

async function ensureEngineReady() {
  if (!state.engine) {
    state.engine = new StockfishClient();
    await state.engine.init();
  }
}

async function analyzeSingleMove(move, depth) {
  const turn = move.beforeFen.split(" ")[1];
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

  const playedLine = candidateLines.find((line) => line.uci === move.uci);
  let playedScore = playedLine?.scoreWhite ?? null;

  if (!playedLine) {
    const after = await state.engine.analyze(move.afterFen, {
      depth: Math.max(6, depth - 2),
      multipv: 1,
    });
    const bestAfter = after.lines[0];
    if (bestAfter) {
      playedScore = bestAfter.scoreWhite;
    }
  }

  return {
    playedScore,
    playedDisplay: formatScoreForTurn(playedScore, turn),
    bestLine: candidateLines[0] || null,
    alternatives: buildAlternatives(move, candidateLines, playedScore),
  };
}

function schedulePlayMoveAnalysis(move) {
  clearPendingPlayAnalysis();
  setBusy(true, "Engine pending");
  setProgress(0);
  setLog(`Played ${move.san}. Engine will score it in 2 seconds.`);

  state.playAnalysisTimer = window.setTimeout(() => {
    state.playAnalysisTimer = null;
    analyzePlayedMove(move);
  }, 2000);
}

function clearPendingPlayAnalysis() {
  if (!state.playAnalysisTimer) return;
  window.clearTimeout(state.playAnalysisTimer);
  state.playAnalysisTimer = null;
  setBusy(false);
}

async function analyzePlayedMove(move) {
  if (state.analyzing) return;
  const currentMove = state.moves[move.ply - 1];
  if (!currentMove || currentMove.uci !== move.uci || currentMove.beforeFen !== move.beforeFen) {
    setBusy(false);
    return;
  }

  state.analyzing = true;
  setBusy(true, "Engine running");
  setEngineStatus("Scoring move", true);
  setProgress(0);

  try {
    await ensureEngineReady();
    const depth = Number(els.depthInput.value);
    state.analysis.set(move.ply, await analyzeSingleMove(move, depth));
    setProgress(100);
    setLog(`Engine scored ${move.san}.`);
    setEngineStatus("Engine ready", false);

    if (state.currentPly === move.ply) {
      renderBoard(chessAtPly(state.currentPly));
      renderAnalysis();
    }
    renderMoveList();
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
  if (playedMoverScore == null) return [];

  const ranked = lines
    .filter((line) => line.uci && line.uci !== move.uci)
    .map((line) => ({
      ...line,
      san: uciToSan(move.beforeFen, line.uci),
      moverScore: scoreForMover(line.scoreWhite, turn),
      displayScore: formatScoreForTurn(line.scoreWhite, turn),
    }))
    .filter((line) => line.san && line.moverScore != null && line.moverScore > playedMoverScore)
    .sort((a, b) => b.moverScore - a.moverScore || a.multipv - b.multipv);

  return ranked.slice(0, 3);
}

function scoreForMover(scoreWhite, turn) {
  if (scoreWhite == null) return null;
  return turn === "w" ? scoreWhite : -scoreWhite;
}

function formatScoreForTurn(scoreWhite, turn) {
  const score = scoreForMover(scoreWhite, turn);
  if (score == null) return "-";
  if (Math.abs(scoreWhite) > 900) {
    const mateDistance = Math.max(1, Math.round(1000 - Math.abs(scoreWhite)));
    return `${score > 0 ? "+" : "-"}M${mateDistance}`;
  }
  return formatCp(score);
}

function goToPly(ply) {
  state.selectedSquare = null;
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
  const legalTargets = state.playMode && state.selectedSquare
    ? legalTargetsForSquare(chess, state.selectedSquare)
    : new Set();
  const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const fragments = [];

  for (let rankIndex = 0; rankIndex < 8; rankIndex += 1) {
    for (let fileIndex = 0; fileIndex < 8; fileIndex += 1) {
      const squareName = `${files[fileIndex]}${8 - rankIndex}`;
      const piece = board[rankIndex][fileIndex];
      const color = (rankIndex + fileIndex) % 2 === 0 ? "light" : "dark";
      const lastClass = lastMove && (lastMove.from === squareName || lastMove.to === squareName) ? " last-move" : "";
      const selectedClass = state.playMode && state.selectedSquare === squareName ? " selected-square" : "";
      const targetClass = state.playMode && legalTargets.has(squareName) ? " legal-target" : "";
      const occupiedClass = piece ? " occupied-square" : "";
      const rankLabel = fileIndex === 0 ? `<span class="coord rank">${8 - rankIndex}</span>` : "";
      const fileLabel = rankIndex === 7 ? `<span class="coord file">${files[fileIndex]}</span>` : "";
      fragments.push(
        `<div class="square ${color}${lastClass}${selectedClass}${targetClass}${occupiedClass}" data-square="${squareName}">${rankLabel}${fileLabel}${renderPiece(piece)}</div>`
      );
    }
  }

  els.board.innerHTML = `${fragments.join("")}${renderArrowLayer(lastMove)}`;

  if (state.currentPly === 0) {
    els.boardCaption.textContent = "Starting position";
  } else {
    const move = state.moves[state.currentPly - 1];
    els.boardCaption.textContent = `${move.number}${move.side === "b" ? "..." : "."} ${move.san}`;
  }
}

function renderPiece(piece) {
  if (!piece) return "";
  const code = `${piece.color}${piece.type.toUpperCase()}`;
  return `<img class="piece" src="${LICHESS_PIECE_BASE}/${code}.svg" alt="" aria-hidden="true" draggable="false" />`;
}

function renderArrowLayer(move) {
  if (!move) return "";

  const analysis = state.analysis.get(move.ply);
  if (!analysis) return "";

  const arrows = [
    {
      from: move.from,
      to: move.to,
      text: analysis.playedDisplay || "-",
      style: ARROW_STYLES.played,
      index: 0,
    },
    ...analysis.alternatives.map((line, index) => {
      const parts = uciParts(line.uci);
      return {
        from: parts.from,
        to: parts.to,
        text: line.displayScore,
        style: ARROW_STYLES[`alt${index + 1}`],
        index: index + 1,
      };
    }),
  ].filter((arrow) => arrow.from && arrow.to);

  if (!arrows.length) return "";

  const defs = Object.values(ARROW_STYLES)
    .map(
      (style) => `
        <marker id="${style.markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="${style.color}"></path>
        </marker>
      `
    )
    .join("");

  return `
    <svg class="arrow-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>${defs}</defs>
      ${arrows.map(renderArrow).join("")}
    </svg>
  `;
}

function renderArrow(arrow) {
  const from = squareCenter(arrow.from);
  const to = squareCenter(arrow.to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;
  const start = {
    x: from.x + unitX * 3.2,
    y: from.y + unitY * 3.2,
  };
  const end = {
    x: to.x - unitX * 4.6,
    y: to.y - unitY * 4.6,
  };
  const labelPoint = arrowLabelPosition(start);
  const label = arrow.text;

  return `
    <g class="board-arrow ${arrow.style.className}">
      <line
        x1="${start.x.toFixed(2)}"
        y1="${start.y.toFixed(2)}"
        x2="${end.x.toFixed(2)}"
        y2="${end.y.toFixed(2)}"
        marker-end="url(#${arrow.style.markerId})"
      ></line>
      <foreignObject
        class="arrow-label-wrap"
        x="${labelPoint.x.toFixed(2)}"
        y="${labelPoint.y.toFixed(2)}"
        width="${ARROW_LABEL_WIDTH}"
        height="${ARROW_LABEL_HEIGHT}"
      >
        <div xmlns="http://www.w3.org/1999/xhtml" class="arrow-label">${escapeHtml(label)}</div>
      </foreignObject>
    </g>
  `;
}

function squareCenter(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  return {
    x: ((file + 0.5) / 8) * 100,
    y: ((8 - rank + 0.5) / 8) * 100,
  };
}

function arrowLabelPosition(point) {
  const x = clamp(point.x - ARROW_LABEL_WIDTH / 2, 0.5, 99.5 - ARROW_LABEL_WIDTH);
  const y = clamp(point.y - ARROW_LABEL_HEIGHT / 2, 0.5, 99.5 - ARROW_LABEL_HEIGHT);
  return { x, y };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
    clearParseErrors();
    return;
  }

  const preview = state.errors.slice(0, 8).map((error) => error.token).join(", ");
  const more = state.errors.length > 8 ? `, plus ${state.errors.length - 8} more` : "";
  els.parseErrors.hidden = false;
  els.parseErrors.textContent = `Skipped ${state.errors.length} token(s): ${preview}${more}. You can edit the move text and parse again.`;
}

function renderSkippedTokenHighlights(errors) {
  if (!errors.length) {
    clearSkippedTokenHighlights();
    return;
  }

  const text = els.pgnText.value;
  const ranges = skippedTokenRanges(text, errors);

  if (!ranges.length) {
    clearSkippedTokenHighlights();
    return;
  }

  let html = "";
  let cursor = 0;

  for (const range of ranges) {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }

  html += escapeHtml(text.slice(cursor));
  els.skipHighlights.innerHTML = html.replace(/\n$/g, "\n ");
  syncSkippedTokenHighlights();
}

function clearSkippedTokenHighlights() {
  els.skipHighlights.innerHTML = "";
}

function syncSkippedTokenHighlights() {
  els.skipHighlights.scrollTop = els.pgnText.scrollTop;
  els.skipHighlights.scrollLeft = els.pgnText.scrollLeft;
}

function skippedTokenRanges(text, errors) {
  const ranges = [];
  let cursor = 0;

  for (const error of errors) {
    const match = findSkippedTokenRange(text, error.token, cursor);
    if (!match) continue;

    const previous = ranges[ranges.length - 1];
    if (previous && match.start < previous.end) continue;

    ranges.push(match);
    cursor = match.end;
  }

  return ranges;
}

function findSkippedTokenRange(text, token, cursor) {
  const candidates = skippedTokenCandidates(token);

  for (const candidate of candidates) {
    const directIndex = text.indexOf(candidate, cursor);
    if (directIndex !== -1) return { start: directIndex, end: directIndex + candidate.length };
  }

  const lowerText = text.toLowerCase();
  for (const candidate of candidates) {
    const lowerCandidate = candidate.toLowerCase();
    const index = lowerText.indexOf(lowerCandidate, cursor);
    if (index !== -1) return { start: index, end: index + candidate.length };
  }

  return null;
}

function skippedTokenCandidates(token) {
  const candidates = new Set([token]);
  candidates.add(token.replace(/O/g, "0"));
  candidates.add(token.replace(/0/g, "O"));
  candidates.add(token.replace(/1/g, "I"));
  candidates.add(token.replace(/1/g, "l"));
  candidates.add(token.replace(/I/g, "1").replace(/l/g, "1"));
  return [...candidates].filter(Boolean).sort((left, right) => right.length - left.length);
}

function updateNavButtons() {
  els.toStartButton.disabled = state.currentPly === 0;
  els.prevButton.disabled = state.currentPly === 0;
  els.nextButton.disabled = state.currentPly >= state.moves.length;
  els.toEndButton.disabled = state.currentPly >= state.moves.length;
}

function setBusy(isBusy, label = "") {
  state.busy = isBusy;
  els.cleanupButton.disabled = isBusy;
  els.pasteButton.disabled = isBusy;
  els.playModeToggle.disabled = isBusy;
  els.analyzeButton.disabled = isBusy;
  els.parseButton.disabled = isBusy;
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

function uciParts(uci) {
  return {
    from: uci?.slice(0, 2) || "",
    to: uci?.slice(2, 4) || "",
    promotion: uci?.slice(4, 5) || "",
  };
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return "";
  try {
    const chess = new Chess(fen);
    const parts = uciParts(uci);
    const move = chess.move({
      from: parts.from,
      to: parts.to,
      promotion: parts.promotion || undefined,
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
