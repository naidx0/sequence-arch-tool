---
name: research
description: Grounded research: write the questions, gather from workspace and web, cite only opened sources, label observed vs inferred vs unknown. Use when the user wants a long-running literature review, a research report with citations, or a GPT-Researcher-style loop. Never invent a count, star rating, or paper year.
---

# Research

A Sequence-native research loop. Public projects this follows (link only; do not copy their prompts): [GPT Researcher](https://github.com/assafelovic/gpt-researcher) and [STORM](https://github.com/stanford-oval/storm).

## Loop

1. Write the questions the report must answer. Stop here until the questions are explicit. If the user gave a vague topic, turn it into a short list of questions you can actually check.
2. Gather from the workspace first. If a browser or search tool exists, use it for the web. If those tools are missing, say so and continue with what you can open locally. Do not install a search CLI, do not create an account, and do not tell the user to sign up for a research product.
3. Keep only sources you actually opened. A title in a search hit is not a source. If you could not open it, it is unknown.
4. Write the report with citations that point at those opened sources (workspace path, or a GitHub or https URL you fetched).
5. Label every substantive claim as **observed**, **inferred**, or **unknown**.

## Grounding

- Never invent a count, a star rating, a paper year, an author list, or a venue.
- If a year, citation count, or metric is not in a source you opened, write unknown.
- Quote or paraphrase with enough of the original that the reader can check it.
- Separate what the workspace already contains from what the web added.

## When to stop

The questions from step 1 are answered, or you have named the ones that remain unknown and why (tool missing, source unreadable, behind a login). Do not pad the report to look complete.
