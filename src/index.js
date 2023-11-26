
const core = require('@actions/core');
const { Toolkit } = require('actions-toolkit');
const issueParser = require('issue-parser');
const parse = issueParser('github');
Toolkit.run(async tools => {
  try {
    if (!tools.context.payload.pull_request) {
      tools.log.warn('Not a pull request skipping verification!');
      return;
    }

    tools.log.debug('Starting Linked Issue Verification!');
    await verifyLinkedIssue(tools);

  } catch (err) {
    tools.log.error(`Error verifying linked issue.`)
    tools.log.error(err)

    if (err.errors) tools.log.error(err.errors)
    const errorMessage = "Error verifying linked issue."
    core.setFailed(errorMessage + '\n\n' + err.message)
    tools.exit.failure()
  }
}, {
  secrets: ['GITHUB_TOKEN']
});

/**
 *
 * @param {Toolkit} tools
 */
async function verifyLinkedIssue(tools) {
  const { context, github, log } = tools;

  let linkedIssue = await checkBodyForValidIssue(tools);

  const isQuiet = core.getInput('quiet') === 'true';
  const noComment = isQuiet ? isQuiet : (core.getInput('no_comment') === 'true');
  if (!linkedIssue) {
    linkedIssue = await checkEventsListForConnectedEvent(tools);
  }

  if (linkedIssue) {
    log.success("Success! Linked Issue Found!");
    core.setOutput("has_linked_issues", "true");
  } else {
    if (!noComment) {
      await createMissingIssueComment(tools);
    } else {
      log.error("No comment mode enabled, no comment added!");
    }
    core.setOutput("has_linked_issues", "false");
    log.error("No Linked Issue Found!");
    if (!isQuiet) {
      core.setFailed("No Linked Issue Found!");
      tools.exit.failure()
    }
  }
}

/**
 *
 * @param {Toolkit} tools
 */
async function checkBodyForValidIssue(tools) {
  const { context, github, log } = tools;

  let body = context.payload.pull_request.body;
  log.debug(`Checking PR Body: "${body}"`)
  const matches = parse(body);
  log.debug(`regex matches: ${matches}`)
  if (matches.allRefs) {
    for (let i = 0, len = matches.allRefs.length; i < len; i++) {
      let match = matches.allRefs[i];
      let issueId = match.issue;
      let owner = context.repo.owner;
      let repo = context.repo.repo;
      if (match.slug) {
        let slugParts = match.slug.split('/');
        owner = slugParts[0];
        repo = slugParts[1];
      }
      log.debug(`verfiying match is a valid issue issueId: ${issueId}`)
      try {
        let issue = await github.issues.get({
          owner: owner,
          repo: repo,
          issue_number: issueId,
        });
        if (issue) {
          log.debug(`Found issue in PR Body ${match.raw}`);
          return true;
        }
      } catch (err) {
        log.debug(err);
        log.debug(`#${issueId} is not a valid issue.`);
      }
    }
  }
  return false;
}

/**
 *
 * @param {Toolkit} tools
 */
async function checkEventsListForConnectedEvent(tools) {
  const { context, github, log } = tools;

  let pull = await github.issues.listEvents({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.payload.pull_request.number
  });

  let hasConnectedEvents = false;
  if (pull.data) {
    log.debug(`Checking events: ${pull.data}`)
    pull.data.forEach(item => {

      if (item.event == "connected") {
        log.debug(`Found connected event.`);
        hasConnectedEvents = true;
      }
    });
  }
  return hasConnectedEvents;
}

/**
 *
 * @param {Toolkit} tools
 */
async function createMissingIssueComment(tools) {
  const { context, github, log } = tools;

  const defaultMessage = 'Build Error! No Linked Issue found. Please link an issue or mention it in the body using #<issue_id>';
  let messageBody = core.getInput('message');
  if (!messageBody) {
    let filename = core.getInput('filename');
    if (!filename) {
      filename = '.github/VERIFY_PR_COMMENT_TEMPLATE.md';
    }
    try {
      const file = tools.getFile(filename);
      if (file) {
        messageBody = file;
      } else {
        messageBody = defaultMessage;
      }
    } catch (err) {
      log.debug(err);
      messageBody = defaultMessage;
    }
  }

  log.debug(`Adding comment to PR. Comment text: ${messageBody}`);
  await github.issues.createComment({
    issue_number: context.payload.pull_request.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
    body: messageBody
  });
}


