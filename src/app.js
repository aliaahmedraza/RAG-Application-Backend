import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { QdrantVectorStore } from "@langchain/qdrant";
import { CohereEmbeddings } from "@langchain/community/embeddings/cohere";
import { CohereClient } from "cohere-ai";
// import OpenAI from "openai"; // Removed as it's not used

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "https://pdfrag-five.vercel.app" }));
app.use(express.json());

const connection = new IORedis(process.env.VALKEY_URL, { // VALKEY_URL is already an env var
    maxRetriesPerRequest: null
});
console.log("✅ Redis connected in API:", process.env.VALKEY_URL);


const queue = new Queue(process.env.QUEUE_NAME || 'file-upload-queue', { connection });


const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, process.env.UPLOAD_DIR || "uploads/");
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${file.originalname}-${uniqueSuffix}`);
    },
});

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are allowed!'), false);
    }
};

const upload = multer({ storage, fileFilter });

app.post("/upload/pdf", upload.single("pdf"), async (req, res) => {
    // req.file will be undefined if fileFilter rejected or no file was provided
    // The custom error handler will catch the 'Only PDF files are allowed!' error
    if (!req.file) {
        return res.status(400).json({
            error: "No file received or file rejected by filter."
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

app.get("/chat", async (req, res) => {
    const userQuery = req.query.message;
    if (!userQuery) {
        return res.status(400).json({
            error: "No query provided. Please provide a query in the URL as a query parameter."
        });
    }

    const embeddings = new CohereEmbeddings({
        apiKey: process.env.COHERE_API_KEY, // Already an env var
        model: process.env.COHERE_EMBED_MODEL || "embed-english-v3.0",
    });

    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
        url: process.env.QDRANT_URL, // Already an env var
        collectionName: process.env.QDRANT_COLLECTION_NAME || "pdf-docs",
    });

    const retriever = vectorStore.asRetriever({ k: parseInt(process.env.RETRIEVER_K_VALUE) || 2 });
    const result = await retriever.invoke(userQuery);

    const SESTEM_PROMPT = `You are a helpful assistant. Please answer clearly and accurately from the provided context.\nContext: ${JSON.stringify(result)}`;
    const promptText = `${SESTEM_PROMPT}\n\nUser: ${userQuery}\nAssistant: `;

    const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

    try {
        const chatResult = await cohere.generate({
            model: process.env.COHERE_CHAT_MODEL || "command-r-plus",
            prompt: promptText,
            max_tokens: parseInt(process.env.CHAT_MAX_TOKENS) || 300,
            temperature: parseFloat(process.env.CHAT_TEMPERATURE) || 0.7,
        });

        const answer = chatResult?.generations?.[0]?.text;

        let message2 = "Query processed successfully";
        if (!answer || answer === "No response generated.") {
            message2 = "Query processed, but no answer generated.";
        }

        return res.status(200).json({
            message: answer || "No response generated.",
            message2: message2,
            docs: result,
        });
    } catch (error) {
        console.error("Error processing query:", error);
        return res.status(500).json({
            error: "Failed to process your query. Please try again later."
        });
    }
});

const port = process.env.PORT || 3006;

// Custom error handler for Multer errors and others
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    } else if (err) {
      if (err.message === 'Only PDF files are allowed!') {
          return res.status(400).json({ error: err.message });
      }
      return res.status(500).json({ error: 'An unexpected error occurred.' });
    }
    next();
  });

app.listen(port, () => {
    console.log(`✅ API Server is running on port ${port}`);
});