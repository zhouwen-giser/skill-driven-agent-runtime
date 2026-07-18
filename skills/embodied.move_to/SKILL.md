# embodied.move_to

## Goal

Move one identified resource to a permitted target and prove its authoritative final position.

## Non-goals

- Do not select or override a resource reservation owned by the Provider.
- Do not enter forbidden areas or weaken permission, confirmation, cancellation, or evidence policy.
- Do not report completion from a Provider success claim without the required final-position evidence.

## Usage

Resolve current position, resource state, and permission context before choosing guidance, template, or
procedure mode. Bind `embodied.move` only through the declared Provider policy. On cancellation, request
cooperative cancellation and preserve uncertainty until the Provider supplies an authoritative terminal
observation. On failure, retain the last authoritative position and report the unachieved target.

## Success evidence

Success requires a final-position observation tied to the selected resource and target. Missing or stale
position evidence is a hard gate even when a Provider claims success.
