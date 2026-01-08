import os
import json
from io import BytesIO
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI
from PyPDF2 import PdfReader

# ---------------------------
# FastAPI app setup
# ---------------------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # OK for development; you can restrict later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping")
def ping():
    return {"message": "pong"}


# ---------------------------
# Pydantic models
# ---------------------------

class GenerateRequest(BaseModel):
    text: str


class Flashcard(BaseModel):
    question: str
    answer: str


class GenerateResponse(BaseModel):
    flashcards: List[Flashcard]


# ---------------------------
# OpenAI client
# ---------------------------

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


# ---------------------------
# Prompt + helpers
# ---------------------------

def build_prompt(notes_text: str) -> str:
    """
    Create the prompt we send to the AI model.
    """
    return f"""
You are an assistant that generates study flashcards from notes.

Output format rules (very important):
- Respond with ONLY valid JSON.
- The JSON must be an array (list).
- Each item in the array must be an object with exactly two keys: "question" and "answer".
- Both "question" and "answer" must be strings.
- Do NOT include any extra fields.
- Do NOT include explanations or text outside the JSON.
- Do NOT use markdown.
- Do NOT wrap the JSON in backticks.

Content rules:
- Make each question short and focused.
- Answers should be concise but complete (1 to 4 sentences).
- Summarize instead of copying long paragraphs.
- Cover the main concepts, definitions, formulas, or key ideas from the text.
- If there is enough material, aim for 20–30 flashcards.
- In any case, try to generate at least 10 flashcards if possible.

Here is the input text for generating flashcards:

[START OF NOTES]
{notes_text}
[END OF NOTES]

Return ONLY the JSON array of flashcards, nothing else.
"""


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """
    Take raw PDF bytes and return extracted text using PyPDF2.
    """
    reader = PdfReader(BytesIO(pdf_bytes))
    pages_text: List[str] = []
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            pages_text.append(page_text)
    return "\n\n".join(pages_text)


def create_flashcards_from_text(text: str) -> List[Flashcard]:
    """
    Core logic: call OpenAI with prompt and turn response into a list[Flashcard].
    """
    # Optional: prevent extremely long input
    if len(text) > 10000:
        text = text[:10000]

    prompt = build_prompt(text)

    response = client.chat.completions.create(
        model="gpt-4.1-mini",   # change model here if you want
        messages=[
            {"role": "system", "content": "You generate JSON flashcards for students."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.3,
    )

    raw_content = response.choices[0].message.content.strip()

    # First try: parse as-is
    try:
        data = json.loads(raw_content)
    except json.JSONDecodeError:
        # Fallback: try to extract the JSON array between [ and ]
        start = raw_content.find("[")
        end = raw_content.rfind("]")
        if start == -1 or end == -1:
            raise HTTPException(
                status_code=500,
                detail="AI did not return valid JSON."
            )
        data = json.loads(raw_content[start:end + 1])

    flashcards: List[Flashcard] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        q = item.get("question")
        a = item.get("answer")
        if isinstance(q, str) and isinstance(a, str):
            flashcards.append(Flashcard(question=q, answer=a))

    return flashcards


# ---------------------------
# Endpoints
# ---------------------------

@app.post("/api/generate-flashcards", response_model=GenerateResponse)
def generate_flashcards(req: GenerateRequest):
    """
    Takes raw text in req.text, sends it to the AI, and returns flashcards.
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty.")

    try:
        flashcards = create_flashcards_from_text(text)
        return GenerateResponse(flashcards=flashcards)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload-and-generate", response_model=GenerateResponse)
async def upload_and_generate(
    files: Optional[List[UploadFile]] = File(None),
    extra_text: str = Form(""),
):
    """
    Accepts uploaded files (PDF/TXT) + extra text from a form, combines all text,
    and generates flashcards from it.
    """
    text_parts: List[str] = []

    # Text from textarea
    if extra_text.strip():
        text_parts.append(extra_text.strip())

    # Text from files
    if files:
        for f in files:
            content = await f.read()
            filename = (f.filename or "").lower()
            content_type = f.content_type or ""

            if content_type == "application/pdf" or filename.endswith(".pdf"):
                extracted = extract_text_from_pdf_bytes(content)
                if extracted.strip():
                    text_parts.append(extracted.strip())
            elif content_type.startswith("text/") or filename.endswith(".txt"):
                try:
                    txt = content.decode("utf-8", errors="ignore")
                    if txt.strip():
                        text_parts.append(txt.strip())
                except Exception:
                    # skip weird encodings
                    continue
            else:
                # ignore other file types
                continue

    combined_text = "\n\n".join(text_parts).strip()

    if not combined_text:
        raise HTTPException(status_code=400, detail="No usable text found in files or textarea.")

    try:
        flashcards = create_flashcards_from_text(combined_text)
        return GenerateResponse(flashcards=flashcards)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
