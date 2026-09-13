# Cost

Agents cost money, and a number nobody tracks is a number that surprises you at
the end of the month. kandy tracks it per run, per note and per agent — and is
careful about how much of it is actually known.

## Two kinds of number

**Claude Code reports dollars.** Its `result` event carries `total_cost_usd`, so
that figure is what it was billed.

**Codex reports only tokens.** There is no dollar figure anywhere in its output
or its session files. kandy computes one from the token counts and the model,
priced against
[LiteLLM's table](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
— the same table `ccusage` uses — fetched once a day and cached.

Cache reads and cache writes are billed at their own rates rather than at the
input rate, since treating them the same overstates every long session.

## Which is which

Every run records where its cost came from:

| Source | Meaning |
| --- | --- |
| `reported` | The agent gave a dollar figure. |
| `estimated` | Computed from tokens against the price table. |
| `unpriced` | Tokens are known; no rate was found. Counted in tokens, excluded from cost. |

An estimated figure is shown as `≈$0.42`. A total made of both carries the `≈`
and says how many runs were unpriced, rather than presenting one confident
number that is partly a guess.

![Usage, per agent and per note](/shots/usage.png)

## Where to look

**Usage** in the sidebar: spend and tokens per agent and per note.

Or from the terminal:

```sh
kandy stats
```

::: warning
A price table goes stale. An estimate is an estimate, and kandy marks it as one
everywhere it appears — but for anything that matters, your provider's billing
page is the source of truth.
:::
