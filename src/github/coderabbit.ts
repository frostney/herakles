import type { GitHubReviewThread } from "../domain";
import { runCommand } from "../utils/command";

type Runner = typeof runCommand;

type GraphQlThread = {
  id: string;
  isResolved: boolean;
  path?: string | null;
  line?: number | null;
  comments?: {
    nodes?: {
      id: string;
      body: string;
      author?: { login?: string } | null;
      path?: string | null;
      line?: number | null;
      url?: string | null;
      createdAt?: string | null;
    }[];
  };
};

type GraphQlResponse = {
  data?: {
    repository?: {
      pullRequest?: {
        reviewThreads?: {
          nodes?: GraphQlThread[];
        };
      };
    };
  };
};

const reviewThreadQuery = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          path
          line
          comments(first: 20) {
            nodes {
              id
              body
              author { login }
              path
              line
              url
              createdAt
            }
          }
        }
      }
    }
  }
}
`;

export async function listPullRequestReviewThreads(
  repo: string,
  prNumber: number,
  runner: Runner = runCommand,
): Promise<GitHubReviewThread[]> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Expected owner/repo, got ${repo}`);
  const result = await runner([
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${reviewThreadQuery}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${prNumber}`,
  ]);
  const parsed = JSON.parse(result.stdout) as GraphQlResponse;
  return (
    parsed.data?.repository?.pullRequest?.reviewThreads?.nodes?.map((thread) =>
      normalizeThread(repo, prNumber, thread),
    ) ?? []
  );
}

export function codeRabbitThreads(threads: readonly GitHubReviewThread[]): GitHubReviewThread[] {
  return threads.filter(
    (thread) =>
      !thread.isResolved &&
      thread.comments.some((comment) => isCodeRabbitAuthor(comment.author ?? "")),
  );
}

function normalizeThread(
  repo: string,
  prNumber: number,
  thread: GraphQlThread,
): GitHubReviewThread {
  const normalized: GitHubReviewThread = {
    repo,
    prNumber,
    id: thread.id,
    isResolved: thread.isResolved,
    comments:
      thread.comments?.nodes?.map((comment) => ({
        id: comment.id,
        body: comment.body,
        ...(comment.author?.login ? { author: comment.author.login } : {}),
        ...(comment.path ? { path: comment.path } : {}),
        ...(comment.line ? { line: comment.line } : {}),
        ...(comment.url ? { url: comment.url } : {}),
        ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
      })) ?? [],
  };
  if (thread.path) normalized.path = thread.path;
  if (thread.line) normalized.line = thread.line;
  return normalized;
}

function isCodeRabbitAuthor(login: string): boolean {
  return login.toLowerCase().includes("coderabbit");
}
