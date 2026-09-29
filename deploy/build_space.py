"""
Assemble (and optionally publish) the Hugging Face Space for Supplychainer.

    python deploy/build_space.py                          # build into deploy/_space_build/
    python deploy/build_space.py --push YOUR_NAME/supplychainer

--push needs a Hugging Face *write* token in the HF_TOKEN environment variable
(create one at https://huggingface.co/settings/tokens). The Space is created if it
doesn't exist yet (public, Docker SDK) and every file is uploaded in one commit.
"""
import argparse
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "deploy", "_space_build")
TEMPLATE = os.path.join(ROOT, "deploy", "huggingface")

# Only what the running app needs: no tests, notebooks, training scripts or the raw dataset.
EXECUTION_FILES = ["risk_model.pkl", "risk_model_p50.pkl", "risk_model_p95.pkl", "label_encoders.pkl",
                   "nlp_anchors.pt", "calibration_profiles.json", "shap_background.json",
                   "quantile_band_report.json"]
SKIP = shutil.ignore_patterns("__pycache__", "*.pyc", "tests", "*.db", "*.db-*")


def build_frontend():
    npm = "npm.cmd" if os.name == "nt" else "npm"
    print("Building the frontend…")
    subprocess.run([npm, "run", "build"], cwd=os.path.join(ROOT, "frontend"), check=True)


def assemble():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "Execution"))
    for name in ("Dockerfile", "README.md", "requirements.txt"):
        shutil.copy2(os.path.join(TEMPLATE, name), OUT)
    shutil.copytree(os.path.join(ROOT, "backend"), os.path.join(OUT, "backend"), ignore=SKIP)
    for name in EXECUTION_FILES:
        shutil.copy2(os.path.join(ROOT, "Execution", name), os.path.join(OUT, "Execution", name))
    shutil.copytree(os.path.join(ROOT, "frontend", "dist"), os.path.join(OUT, "frontend", "dist"))

    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(OUT) for f in fs)
    print(f"Space assembled in {OUT} ({size / 1e6:.1f} MB)")


def push(space_id):
    from huggingface_hub import HfApi
    token = os.getenv("HF_TOKEN")
    if not token:
        sys.exit("Set HF_TOKEN to a Hugging Face write token first (https://huggingface.co/settings/tokens).")
    api = HfApi(token=token)
    api.create_repo(space_id, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
    api.upload_folder(folder_path=OUT, repo_id=space_id, repo_type="space",
                      commit_message="Deploy Supplychainer", delete_patterns=["*"])
    owner, name = space_id.split("/")
    print(f"\nPushed. Build logs: https://huggingface.co/spaces/{space_id}")
    print(f"Public link (live once the build finishes, ~5-10 min): https://{owner.lower()}-{name.lower()}.hf.space")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--push", metavar="OWNER/SPACE", help="create/update this Space on Hugging Face")
    ap.add_argument("--skip-frontend", action="store_true", help="reuse the existing frontend/dist build")
    args = ap.parse_args()
    if not args.skip_frontend:
        build_frontend()
    assemble()
    if args.push:
        push(args.push)
