# Skill Co-Occurrence Mining for Cooperative Employment Planning

**Smart India Hackathon 2026 · Problem statement SIH26087 · Ministry of Cooperation**
*AI-Enabled Cooperative Capacity Building, ERP & Employment Ecosystem*

**Team:** Surendra Reddy Kota (12418513), Katikala Srisaa (12410329)
**Faculty:** Piyush Sharma, Lovely Professional University

Skills are trained one qualification at a time, although employers hire for combinations no single
qualification covers. This project mines **which skills genuinely occur together in real job postings**
using association rule mining (Apriori and FP-Growth), filters weak or coincidental rules by support,
confidence and lift, tracks how the strongest combinations shift over time, and turns the surviving
rules into **combined training programmes**.

```
REAL JOB POSTINGS → PREPROCESSING → SKILL TRANSACTIONS → APRIORI / FP-GROWTH
                  → LIFT FILTERING → RANKED COMBINATIONS → TRAINING PLANNING DASHBOARD
```

## How it is built

| Part | Technology | Where it runs |
|---|---|---|
| Data pipeline: download, checksum verification, cleaning, skill normalisation, export | **Python** (pandas, mlxtend) | Your computer, once (`pipeline/`) |
| Website and dashboard | **Next.js 16 + TypeScript + Tailwind CSS** | **Vercel** |
| Apriori, FP-Growth, rules, ranking, temporal analysis, recommender | **TypeScript** in a Web Worker | The visitor's browser, live |

The website ships the 670,261 cleaned real postings as a 2.4 MB compressed file and mines them **live in the
browser** whenever the thresholds change. No server or database is needed, so it deploys to Vercel as a
static site. The TypeScript miners are tested to reproduce the Python `mlxtend` results **exactly**
(identical itemsets, counts and metrics to 12 decimal places).

## Headline results (default thresholds: support 1 %, confidence 30 %, lift 1.2, length ≤ 3)

| | |
|---|---|
| Postings in source / cleaned transactions | 787,686 / 670,261 |
| Canonical skills | 239 |
| Frequent itemsets → rules generated → rules surviving | 1,002 → 3,944 → 1,386 |
| Top rule | NumPy + Python → Pandas (confidence 90.1 %, lift 18.7, 17,625 postings) |
| Baseline vs association | 17 of the 45 pairs of the 10 most frequent skills co-occur *less* than chance |
| Temporal (2023 Q1–Q4) | 33 tracked rules: 11 emerging, 4 declining |

## Deploy to Vercel

1. Push this folder to a new GitHub repository (GitHub Desktop: *File → Add local repository*, then *Publish repository*).
2. Go to **https://vercel.com/new** and sign in with GitHub.
3. **Import** the repository. Vercel detects Next.js automatically. Keep the defaults:
   - Framework preset: **Next.js**
   - Build command: `next build`
   - Output directory: *(default)*
   - No environment variables are needed.
4. Click **Deploy**. After about a minute you get a public link such as `https://skill-cooccurrence-mining.vercel.app`.

Every later push to GitHub redeploys automatically.

## Run locally

Requires **Node.js 20.9 or newer**.

```bash
npm install
npm run dev        # http://localhost:3000
```

Other commands:

```bash
npm run build      # production build (what Vercel runs)
npm start          # serve the production build
npm test           # 65 TypeScript tests, incl. exact agreement with mlxtend on the real data
npm run typecheck
```

## Rebuild the data with Python (optional)

The processed data is already in `public/data/`. To regenerate it from the original source:

```bash
cd pipeline
python -m venv .venv
.venv\Scripts\activate             # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m scripts.download_data    # downloads ~67 MB and verifies SHA-256 checksums
python -m scripts.build_dataset    # cleaning and skill normalisation
python -m scripts.export_web       # writes public/data/* and tests/fixtures/reference.json
python -m pytest                   # 87 Python tests
```

## Dashboard pages

| Page | What it shows |
|---|---|
| **Overview** | Live skill constellation, headline numbers, most requested skills, strongest combinations, project brief |
| **Skill analysis** | Individual-frequency baseline (top 10/20/30, long tail, skills per posting, quarterly trend), role and country heatmaps, skill explorer, baseline vs association, normalisation trace |
| **Association rules** | Apriori / FP-Growth, support, confidence, lift and length controls, ranking weights, filter stages, ranked rules, rule charts, rule explanations with score breakdown, algorithm comparison, CSV export |
| **Combination explorer** | Skill relationship network, co-occurrence heatmap, strongest combinations by size, rules for one skill |
| **Temporal analysis** | Quarterly re-mining, skill and rule trends, emerging and declining combinations, period comparison, stability |
| **Training planner** | Complementary skills with evidence, combined programme (modules, prerequisites, target roles), role skill gap, supporting rules, CSV and JSON export |
| **Data and methodology** | Project brief, dataset and citation, preprocessing report, method, evaluation, limitations, team, **upload your own postings CSV** |

## Project structure

```
app/                     Next.js pages (one folder per page) and global styles
components/              UI building blocks, charts, network, tables, settings panel
lib/engine/              Mining engine (pure TypeScript): decode, transactions, apriori, fpgrowth,
                         rules, frequency, temporal, recommend, normalize, upload
lib/client/              Browser data loading, Web Worker client, shared state, formatting
lib/project.ts           Project brief and team details
workers/engine.worker.ts Background thread that runs the mining
public/data/             Real dataset exported by the Python pipeline
tests/                   Vitest tests (engine + exact agreement with Python/mlxtend)
pipeline/                Python data pipeline and its tests
docs/                    Dataset sources, methodology, technical notes, limitations
```

## Data source

Barousse, L. (2023). *data_jobs* [Dataset]. Hugging Face. https://huggingface.co/datasets/lukebarousse/data_jobs
(Apache-2.0), retrieved in relational CSV form from a public GitHub mirror and pinned by SHA-256 checksums.
See [`docs/DATASET_SOURCES.md`](docs/DATASET_SOURCES.md).

## Limitations

The verified dataset covers **data and technology roles in 2023**, not cooperative-sector jobs; the method is
domain-independent and any organisation can upload its own vacancy CSV on the *Data and methodology* page.
Country labels in the source are partly unreliable. Recommendations describe employer demand, **not
guaranteed employment outcomes**. See [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md).
