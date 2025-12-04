// @ts-check

/** @type {import('@cloudflare/workers-types').ExportedHandler<{ GITHUB_TOKEN: string }> } */
export default {
    async scheduled(event, env, ctx) {
        const owner = "firlin123";
        const repo = "desuarchive-mlp-backup";
        const workflow = "archive.yml";
        const githubToken = env.GITHUB_TOKEN;

        const body = {
            ref: "main",
            inputs: {},
        };

        try {
            const res = await fetch(
                `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
                {
                    method: "POST",
                    headers: {
                        "Accept": "application/vnd.github+json",
                        "Authorization": `Bearer ${githubToken}`,
                        "X-GitHub-Api-Version": "2022-11-28",
                        "User-Agent": "cf-worker-github-trigger",
                    },
                    body: JSON.stringify(body),
                }
            );

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`GitHub API error: ${res.status} ${errorText}`);
            }

            console.log("✅ GitHub workflow dispatched successfully");
        } catch (err) {
            console.error("❌ Failed to trigger GitHub workflow:", err);
        }
    },
};