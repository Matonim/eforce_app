// Public "social media" snippets. Events are private; an outcome with a `post` template
// publishes one line to the shared feed that every team and the spectator screen can see.
//
// Placeholders:
//   {team}           team name
//   {location}       city
//   {country}        ISO country code
//   {change.<path>}  size of the change this outcome made to <path> (or anything under it),
//                    e.g. {change.budget} → "2,400", {change.personnel} → "1"

export const PLACEHOLDER = /\{([a-z][a-zA-Z.]*)\}/g;
export const CHANGE_PATH = /^change\.(budget|stats(\.(performance|reliability))?|personnel(\.[a-z]+)?)$/;
const FIXED = new Set(['team', 'location', 'country']);

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** @returns {string[]} placeholders in the template that aren't supported */
export function unknownPlaceholders(template) {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]).filter((key) => !FIXED.has(key) && !CHANGE_PATH.test(key));
}

/**
 * @param {string} template
 * @param {import('../game/model.js').Team} team
 * @param {import('../game/model.js').Change[]} changes changes made by the same outcome
 */
export function renderPost(template, team, changes) {
  return template.replace(PLACEHOLDER, (whole, key) => {
    if (key === 'team') return team.name;
    if (key === 'location') return team.location.name;
    if (key === 'country') return team.location.country;
    if (CHANGE_PATH.test(key)) {
      const path = key.slice('change.'.length);
      const total = changes
        .filter((c) => (c.path === path || c.path.startsWith(`${path}.`)) && typeof c.from === 'number' && typeof c.to === 'number')
        .reduce((sum, c) => sum + Math.abs(c.to - c.from), 0);
      return numberFormat.format(total);
    }
    return whole;
  });
}

/** Append a rendered post to the match feed. */
export function publishPost(match, team, eventId, template, changes) {
  const post = {
    id: `p${match.nextPostNumber++}`,
    round: match.round,
    teamId: team.id,
    eventId,
    source: 'event',
    text: renderPost(template, team, changes),
  };
  match.feed.push(post);
  return post;
}
