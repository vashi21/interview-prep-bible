"""Shared hub-body builder. The checklist section contains real per-chapter
links, so it can't be a single static fragment reused as-is by both build
targets — the standalone Claude-Artifact pages need claude.ai URLs, the
personal-site SPA needs hash routes. Both callers pass their own href_for()
and get the correct links; nothing else about the hub body changes."""
import html

PART_SUMMARIES = {
    "Part I — Foundations & Interview Craft": "How the interview is actually scored, and the single worked example (Scale From Zero) everything else builds on.",
    "Part II — Core Scalability Building Blocks": "The techniques that show up inside almost every later answer: caching, load balancing, rate limiting, sharding, replication.",
    "Part III — Databases Deep Dive": "MySQL and MongoDB (plus Redis, DynamoDB, Cassandra, Neo4j, and the data-warehouse world) side by side, in depth.",
    "Part IV — Distributed Systems Theory": "CAP, consensus, and the coordination problems (transactions, locks, quorums) that only show up once you have more than one machine.",
    "Part V — Messaging, Microservices & Cross-Cutting Concerns": "Kafka-style messaging, microservice resiliency patterns, and the security/observability/primitives layer used everywhere.",
    "Part VI — The Problem Bank": "Ninety full worked problems at full interview depth, plus a 199-row rapid-fire index for everything else.",
}


def build_hub_body(reg, href_for):
    """href_for(chapter_dict) -> str. Returns the hub's content HTML (no crumb/hero/footer)."""
    chapters = sorted([c for c in reg["chapters"] if c["num"] != 0], key=lambda c: c["num"])

    parts_seen = []
    seen = set()
    for c in chapters:
        if c["part"] not in seen:
            seen.add(c["part"])
            parts_seen.append(c["part"])

    out = []
    out.append('<h2><span class="idx">00</span>How this book is organized</h2>')
    out.append('<div class="table-scroll"><table class="spec-table"><thead><tr><th>Part</th><th>What it is for</th></tr></thead><tbody>')
    for p in parts_seen:
        out.append(f'<tr><td>{html.escape(p)}</td><td>{html.escape(PART_SUMMARIES.get(p, ""))}</td></tr>')
    out.append('</tbody></table></div>')

    out.append('<div class="callout"><p>If you only have one evening before a round: reread Ch.1 (how the interview is scored) and Ch.2 (Scale From Zero), then skim Ch.22 for pattern-matching, then pick the two or three problems in Ch.17-21 closest to what you expect to be asked.</p></div>')

    out.append('<h2 id="chapters"><span class="idx">01</span>Every chapter, with your progress</h2>')
    out.append('<p>Checkboxes save to your browser only (nothing is sent anywhere) — they will still be here next time you open this page on the same device and browser.</p>')

    current_part = None
    for i, c in enumerate(chapters):
        if c["part"] != current_part:
            current_part = c["part"]
            out.append(f'<h3>{html.escape(current_part)}</h3>')
            out.append('<ul class="progress-list">')
        href = href_for(c) or "#"
        out.append(
            '<li>'
            f'<input type="checkbox" data-persist-key="ch-{c["num"]}" id="prog-ch{c["num"]}" aria-label="Mark Ch.{c["num"]} as studied">'
            '<div>'
            f'<span class="part-tag">Ch.{c["num"]}</span>'
            f'<a href="{html.escape(href)}">{html.escape(c["title"])}</a>'
            f'<div class="desc">{html.escape(c["description"])}</div>'
            '</div>'
            '</li>'
        )
        next_idx = i + 1
        is_last_in_part = next_idx >= len(chapters) or chapters[next_idx]["part"] != current_part
        if is_last_in_part:
            out.append('</ul>')

    out.append('<h2><span class="idx">02</span>What this series does not replace</h2>')
    out.append('<div class="callout em-angle"><p>This series gets you through most HLD rounds up to a senior/EM bar. It will not give you live-interview reps (that needs mock interviews) or research-paper-level depth on distributed systems internals (Kleppmann\'s <em>Designing Data-Intensive Applications</em> is the next stop for that). Treat it as the syllabus, not the whole course.</p></div>')

    return "\n".join(out)
