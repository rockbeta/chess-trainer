# Chess Trainer

Static browser app that turns a screenshot of chess notation into a step-by-step Stockfish review.

## What It Does

- Upload a screenshot of a move list.
- Run in-browser OCR with Tesseract.js.
- Edit the extracted move text before analysis.
- Parse legal SAN moves with chess.js.
- Analyze each position in a Stockfish WASM worker.
- Step through the game and see the played move score plus up to three better alternatives.

## Run Locally

From this directory:

```sh
python3 -m http.server 4173
```

Then open:

```txt
http://localhost:4173
```

You can also run the same server with:

```sh
npm run start
```

The page is static. It loads OCR and move parsing libraries from public CDNs, and includes a vendored Stockfish worker under `vendor/stockfish`:

- Tesseract.js for OCR
- chess.js for legal move parsing
- stockfish.js WASM build for engine analysis

## Notes

OCR is intentionally editable before analysis. Chess notation is compact, and screenshots often produce small mistakes like `0-0` versus `O-O`, `Qxcl` versus `Qxc1`, or missing check symbols.

Depth 8-10 is a practical browser default. Higher depth is more accurate, but it can be slow on laptops and mobile browsers.
