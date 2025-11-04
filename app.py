# webcamRecorder backend

import os
from datetime import datetime
from fastapi import FastAPI, File, WebSocket, WebSocketDisconnect, UploadFile, Form, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import aiofiles
import asyncpg
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

app = FastAPI()

# Allow frontend CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

@app.on_event("startup")
async def startup():
    app.state.db = await asyncpg.create_pool(DATABASE_URL)
    print("Connected to Neon DB")


@app.on_event("shutdown")
async def shutdown():
    await app.state.db.close()
    print("Disconnected from Neon DB")


@app.post("/save-recording/")
async def save_recording(
    request: Request,
    candidate_id: str = Form(...),
    question_id: str = Form(...),
    file: UploadFile = File(...),
):
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{candidate_id}_{question_id}_{timestamp}.webm"
        save_path = os.path.join(UPLOAD_DIR, filename)

        
        async with aiofiles.open(save_path, "wb") as f:
            content = await file.read()
            await f.write(content)

        base_url = str(request.base_url).rstrip("/")
        file_url = f"{base_url}/uploads/{filename}"

        query = """
            INSERT INTO recording (candidate_id, question_id, file_path, file_url, created_at)
            VALUES ($1, $2, $3, $4, NOW())
            RETURNING id, candidate_id, question_id, file_path, file_url, created_at;
        """
        async with app.state.db.acquire() as conn:
            row = await conn.fetchrow(query, candidate_id, question_id, save_path, file_url)

        result = dict(row)
        if isinstance(result.get("created_at"), datetime):
            result["created_at"] = result["created_at"].isoformat()

        result["status"] = "saved"
        return JSONResponse(result)

    except Exception as e:
        print("Error:", e)
        return JSONResponse({"error": str(e)}, status_code=500)
    
clients=[]

@app.websocket("/questions")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.append(websocket)
    try:
        await websocket.send_json({"type": "info", "message": "Connected to interviewer"})

        import asyncio
        sample_questions = [
            {"id": "q1", "text": "Please introduce yourself."},
            {"id": "q2", "text": "What are your strengths?"},
            {"id": "q3", "text": "Describe a challenge you’ve overcome."},
        ]

        for q in sample_questions:
            await asyncio.sleep(5)
            await websocket.send_json({"type": "question", **q})

        await asyncio.sleep(3)
        await websocket.send_json({"type": "end", "message": "Interview ended"})
    except WebSocketDisconnect:
        print("Client disconnected")
    finally:
        if websocket in clients:
            clients.remove(websocket)
