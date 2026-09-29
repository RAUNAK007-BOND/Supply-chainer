"""
Assemble a small, self-contained git repository for deploying Supplychainer on Render (free plan).

    python deploy/build_render.py

Creates deploy/_render_build/ as a git repo with one commit on branch `main`, containing only
what the running app needs. Push it to an empty GitHub repository, then create a Render
Blueprint from it (see the printed steps).
"""
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from build_space import EXECUTION_FILES, ROOT, SKIP, build_frontend  # noqa: E402

OUT = os.path.join(ROOT, "deploy", "_render_build")
TEMPLATE = os.path.join(ROOT, "deploy", "render")


def git(*args):
    subprocess.run(["git", *args], cwd=OUT, check=True, stdout=subprocess.DEVNULL)


def main():
    if "--skip-frontend" not in sys.argv:
        build_frontend()
    if os.path.isdir(OUT):
        shutil.rmtree(OUT, onerror=lambda f, p, _: (os.chmod(p, 0o700), f(p)))
    os.makedirs(os.path.join(OUT, "Execution"))
    for name in ("render.yaml", "requirements.txt", "README.md"):
        shutil.copy2(os.path.join(TEMPLATE, name), OUT)
    shutil.copytree(os.path.join(ROOT, "backend"), os.path.join(OUT, "backend"), ignore=SKIP)
    for name in EXECUTION_FILES:
        shutil.copy2(os.path.join(ROOT, "Execution", name), os.path.join(OUT, "Execution", name))
    shutil.copytree(os.path.join(ROOT, "frontend", "dist"), os.path.join(OUT, "frontend", "dist"))
    with open(os.path.join(OUT, ".gitignore"), "w") as f:
        f.write("__pycache__/\n*.pyc\n*.db\n*.db-*\n")

    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("commit", "-q", "-m", "Deploy Supplychainer to Render")
    size = sum(os.path.getsize(os.path.join(d, f)) for d, ds, fs in os.walk(OUT) if ".git" not in d for f in fs)
    print(f"Render repo ready in {OUT} ({size / 1e6:.1f} MB, 1 commit on 'main').")
    print("Next: push it to an empty GitHub repo, then create a Render Blueprint from that repo.")


if __name__ == "__main__":
    main()
