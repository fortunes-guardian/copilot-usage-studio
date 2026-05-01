# bugs and features

## cached? fixed

UI says
Claude Sonnet 4.6
18 model turns · Anthropic
Claude Sonnet 4.6
430,404 in / 5,628 out
$3 in / $15 out
$0.3 cached / $3.75 write
€1.279338
1.200827 in / 0.078511 out
29%
GPT-5.4
22 model turns · OpenAI
GPT-5.4
1,251,221 in / 13,155 out
$2.5 in / $15 out
$0.25 cached

- Fixed: the selected-run model table no longer shows cached/cache-write price rates when the run has no imported cache-token fields. The GitHub prices page still lists those rates because they are part of GitHub's published pricing table, but the session view now labels cache as "Not in local logs" / "not priced for this run".

## ui layout fixed

- Fixed: session summary is now above the cost debugger and compressed to orientation metrics only.
- Fixed: duplicate Token Pricing, Model Pricing, and old "Why this cost?" sections were removed because the Cost debugger now owns that job.
- Fixed: agent flow chart shows token/cost detail on model-call nodes.
- Fixed: agent flow chart now uses visible flow-step numbering, so filtered setup/discovery events no longer make the first useful node start at a raw event number like #13.

- Fixed: the second summary row is smaller and no longer repeats estimated cost.
- Fixed: the user/assistant transcript block was removed from the session page.

## trace

- make user_message standout, to differentiate, and clearly show, this is a user msg

## ledger

- is this really a ledger? consider rename.

## ui

- these are at the top of the session summary:
  copilot-cost-ledger
  exact
  ?
  llm_request_token_totals
  - they look odd, the tooltips are very cryptic.

- Data ingest summary - compress
- tooltips: too cryptic and technical, hard to understand.

- ui reads: Why this run cost €4.49 and then below it is text - you would think that text answers this - but it doesn't it is "Cache tokens not present in local logs ?" - i don't think this fits.
