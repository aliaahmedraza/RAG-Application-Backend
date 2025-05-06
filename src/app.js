// import express from "express";
// import cors from "cors";
// import dotenv from "dotenv";
// import multer from "multer";
// import { Queue } from 'bullmq';
// import { QdrantVectorStore } from "@langchain/qdrant";
// // import { FakeEmbeddings } from "@langchain/core/utils/testing";
// // import { OpenAIEmbeddings } from "@langchain/openai";
// import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";
// import { CohereClient } from "cohere-ai"; // official cohere SDK
// import OpenAI from "openai";


// dotenv.config();

// const app = express();
// app.use(cors({ origin: "http://localhost:3000" }));
// app.use(express.json());
// // const client = new OpenAI({
// //     apiKey: process.env.OPENAI_API_KEY,
// // });
// const cohere = new CohereClient({
//     token: process.env.COHERE_API_KEY,
// });
// const storage = multer.diskStorage({
//     destination: (_req, _file, cb) => {
//         cb(null, "uploads/");
//     },
//     filename: (_req, file, cb) => {
//         const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
//         cb(null, `${file.originalname}-${uniqueSuffix}`);
//     },
// });
// const queue = new Queue('file-upload-queue', {
//     connection: {
//         host: process.env.REDIS_HOST,
//         port: process.env.REDIS_PORT
//     },
// });
// const upload = multer({ storage });
// app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
//     if (!req.file) {
//         return res.status(400).json({
//             error: "No file received. Please send your PDF in a multipart/form-data body under the field name 'pdf'."
//         });
//     }
//     await queue.add('file-upload', JSON.stringify({
//         filePath: req.file.path,
//         fileName: req.file.originalname,
//         fileSize: req.file.size,
//         destination: req.file.destination,
//     }));
//     res.status(200).json({
//         message: "File uploaded successfully",
//         file: req.file
//     });
// });
// app.get("/chat", async (req, res) => {
//     const userQuery = req.query.message;
//     if (!userQuery) {
//         return res.status(400).json({
//             error: "No query provided. Please provide a query in the URL as a query parameter."
//         });
//     }
//     // const embeddings = new OpenAIEmbeddings({
//     //     model: "text-embedding-3-small",
//     //     apiKey: process.env.OPENAI_API_KEY,
//     // });
//     // const embeddings = new FakeEmbeddings();
//     const embeddings = new CohereEmbeddings({
//         apiKey: process.env.COHERE_API_KEY,
//         model: "embed-english-v3.0",
//     });

//     const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
//         url: process.env.QDRANT_URL,
//         collectionName: "pdf-docs",
//     });
//     const retriever = vectorStore.asRetriever({
//         k: 2,
//     });
//     const result = await retriever.invoke(userQuery);
//     const SESTEM_PROMPT = `You are a helpful assistant.Please answer clearly and accurately from the provide odf context. Context: ${JSON.stringify(result)}`;
//     const promptText = `${SESTEM_PROMPT}\n\nUser: ${userQuery}\nAssistant: `;
//     // const chatResult = await client.chat.completions.create({
//     //     model: "gpt-4.1",
//     //     messages: [
//     //         {
//     //             role: "user",
//     //             content: userQuery,
//     //         },
//     //         {
//     //             role: "assistant",
//     //             content: SESTEM_PROPMT,
//     //         },
//     //     ],
//     // });
//     // return res.status(200).json({
//     //     message: `${ chatResult?.choices[0]?.message?.content } Query processed successfully`,
//     //     docs: result
//     // });
//     const chatResult = await cohere.generate({
//         model: "command-r-plus",
//         prompt: promptText,
//         max_tokens: 300,
//         temperature: 0.7,
//     });

//     const answer = chatResult?.generations?.[0]?.text;

//     return res.status(200).json({
//         message: `${answer} `,
//         message2: `Query processed successfully `,
//         docs: result,
//     });
// });

// const port = process.env.PORT;
// app.listen(port, () => {
//     console.log(`Server is running on port ${port} `);
// });
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { Queue } from 'bullmq';
import IORedis from 'ioredis'; // <-- Add this import
import { QdrantVectorStore } from "@langchain/qdrant";
import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";
import { CohereClient } from "cohere-ai";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors({ origin: "https://rag-application-backend-jvja.onrender.com" }));
app.use(express.json());

// ─── Redis Connection Using VALKEY_URL ───────────────────────────────
const connection = new IORedis(process.env.VALKEY_URL, {
    maxRetriesPerRequest: null
});
console.log("✅ Redis connected in API:", process.env.VALKEY_URL);

// ─── Queue Setup ────────────────────────────────────────────────────
const queue = new Queue('file-upload-queue', { connection });

// ─── Multer Setup ───────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, "uploads/");
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${file.originalname}-${uniqueSuffix}`);
    },
});
const upload = multer({ storage });

// ─── Upload Endpoint ────────────────────────────────────────────────
app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            error: "No file received. Please send your PDF in a multipart/form-data body under the field name 'pdf'."
        });
    }

    await queue.add('file-upload', JSON.stringify({
        filePath: req.file.path,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        destination: req.file.destination,
    }));

    res.status(200).json({
        message: "File uploaded successfully",
        file: req.file
    });
});

// ─── Chat Endpoint ──────────────────────────────────────────────────
app.get("/chat", async (req, res) => {
    const userQuery = req.query.message;
    if (!userQuery) {
        return res.status(400).json({
            error: "No query provided. Please provide a query in the URL as a query parameter."
        });
    }

    const embeddings = new CohereEmbeddings({
        apiKey: process.env.COHERE_API_KEY,
        model: "embed-english-v3.0",
    });

    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
        url: process.env.QDRANT_URL,
        collectionName: "pdf-docs",
    });

    const retriever = vectorStore.asRetriever({ k: 2 });
    const result = await retriever.invoke(userQuery);

    const SESTEM_PROMPT = `You are a helpful assistant. Please answer clearly and accurately from the provided context.\nContext: ${JSON.stringify(result)}`;
    const promptText = `${SESTEM_PROMPT}\n\nUser: ${userQuery}\nAssistant: `;

    const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

    const chatResult = await cohere.generate({
        model: "command-r-plus",
        prompt: promptText,
        max_tokens: 300,
        temperature: 0.7,
    });

    const answer = chatResult?.generations?.[0]?.text;

    return res.status(200).json({
        message: answer || "No response generated.",
        message2: "Query processed successfully",
        docs: result,
    });
});

// ─── Start Server ───────────────────────────────────────────────────
const port = process.env.PORT || 3006;
app.listen(port, () => {
    console.log(`✅ API Server is running on port ${port}`);
});