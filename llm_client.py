import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = os.getenv("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "gpt-4o-mini")

import re
import time

PROMPTS = {
    "mcq": (
        """Generate a single multiple-choice question for the skill '{skill}' at the '{difficulty}' level. 
        Provide exactly {options} answer choices labeled A, B, C, D. 

        Format the response as valid JSON with keys:

        - "prompt": The question text.
        - "options": An array of answer choices.
        - "answer": A single letter (A, B, C, or D).

        IMPORTANT: Only output JSON. Do not include explanations, extra text, or notes. 
        Ensure the JSON is valid and properly formatted."""
    ),

    "coding": (
        """Create a single coding question for the skill '{skill}' at the '{difficulty}' level. 

        Format the response as valid JSON with keys:

        - "prompt": The problem statement.
        - "input_spec": Description of input format.
        - "output_spec": Description of output format.
        - "examples": An array of example inputs and outputs.

        IMPORTANT: Only output JSON. Do not include explanations, extra text, or notes. 
        Ensure the JSON is valid and properly formatted."""
    ),

    "audio": (
        """Generate a concise interview question for the skill '{skill}' at the '{difficulty}' level. 

        Format the response as valid JSON with keys:

        - "prompt_text": The question text.
        - "expected_keywords": An array of keywords expected in a good answer.
        - "rubric": A brief evaluation rubric.

        IMPORTANT: Only output JSON. Do not include explanations, extra text, or notes. 
        Ensure the JSON is valid and properly formatted."""
    ),

    "video": (
        """Generate a concise interview question for the skill '{skill}' at the '{difficulty}' level. 

        Format the response as valid JSON with keys:

        - "prompt_text": The question text.
        - "rubric": A brief evaluation rubric.
        - "suggested_time_seconds": Recommended time in seconds for the candidate's response.

        IMPORTANT: Only output JSON. Do not include explanations, extra text, or notes. 
        Ensure the JSON is valid and properly formatted."""
    ),
}

def generate_question(skill: str, difficulty: str, qtype: str, options: int = 4, retries: int = 3):
    prompt_text = PROMPTS[qtype].format(skill=skill, difficulty=difficulty, options=options)

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": "You are a helpful interview question generator."},
            {"role": "user", "content": prompt_text}
        ],
        "temperature": 0.25, 
        "max_tokens": 600
    }

    for attempt in range(retries):
        try:
            resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]

            # extract only the json obj
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if match:
                content = match.group(0)
                return json.loads(content)
            else:
                if attempt < retries - 1:
                    time.sleep(1)
                    continue
                return {"raw": content, "error": "No JSON found after retries."}

        except (json.JSONDecodeError, KeyError):
            if attempt < retries - 1:
                time.sleep(1)
                continue
            return {"raw": content, "error": "Failed to parse JSON after retries."}
        except requests.RequestException as e:
            return {"error": str(e)}

def evaluate_answer(question_type: str, question_text: str, correct_answer: str, candidate_answer: str):
    """
    Evaluate MCQ or Coding question answers using LLM (OpenRouter).
    Returns a structured JSON with evaluation result.
    """

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }

    if question_type == "mcq":
        eval_prompt = (
            f"You are an evaluator for multiple-choice questions.\n"
            f"Question: {question_text}\n"
            f"Correct Answer: {correct_answer}\n"
            f"Candidate Answer: {candidate_answer}\n"
            f"Evaluate if the candidate's answer is correct.\n"
            f"Return JSON ONLY with keys: is_correct (true/false), score (0 or 1), feedback (short sentence)."
        )

    elif question_type == "coding":
        eval_prompt = (
            f"You are an evaluator for coding questions.\n"
            f"Question: {question_text}\n"
            f"Expected Solution Description: {correct_answer}\n"
            f"Candidate Code:\n{candidate_answer}\n"
            f"Evaluate correctness and efficiency. "
            f"Return JSON ONLY with keys: score (0-10), feedback (short explanation)."
        )

    else:
        raise ValueError("Unsupported question_type for evaluation")

    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {"role": "system", "content": "You are a strict and fair evaluator for technical questions."},
            {"role": "user", "content": eval_prompt}
        ],
        "temperature": 0.2,
        "max_tokens": 400
    }

    resp = requests.post(OPENROUTER_URL, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    try:
        content = data["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception:
        return {"raw": content}