import { GoogleGenAI } from "@google/genai";

interface Env {
    GEMINI_API_KEY: string;
}

export const onRequestPost = async (context: any) => {
    const env = context.env as Env;

    try {
        if (!env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is not configured");
        }

        const body = await context.request.json() as { image: string };
        const base64Image = body.image;
        if (!base64Image) {
            return new Response(JSON.stringify({ error: 'Missing image data' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Handle base64 extraction
        const base64Data = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

        let operation = await ai.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt: 'Make this photo come to life with subtle movement and cinematic feel',
            image: {
                imageBytes: base64Data,
                mimeType: 'image/png', // assuming png/jpeg, Veo can handle
            },
            config: {
                numberOfVideos: 1,
                resolution: '720p',
                aspectRatio: '16:9'
            }
        });

        while (!operation.done) {
            // In a Cloudflare worker, awaiting is fine for moderate times, though there are execution time limits.
            // Pages limits execution to 10ms CPU time, but unbounded wall clock time until the request timeout (100s or more).
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (!downloadLink) {
            throw new Error("Failed to generate video (no URI returned)");
        }

        // Fetch the video data from Google
        const videoResponse = await fetch(downloadLink, {
            method: 'GET',
            headers: {
                'x-goog-api-key': env.GEMINI_API_KEY,
            },
        });

        if (!videoResponse.ok) {
            throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
        }

        // Return stream to client
        return new Response(videoResponse.body, {
            status: 200,
            headers: {
                'Content-Type': videoResponse.headers.get('Content-Type') || 'video/mp4'
            }
        });

    } catch (err: any) {
        console.error("Gemini API Error:", err);
        return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
