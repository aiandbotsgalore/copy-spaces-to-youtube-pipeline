# GitHub Codespaces Cloud Studio Guide

GitHub Codespaces provides a dedicated cloud environment on Microsoft Azure with **60 free core-hours per month** (30 hours on a 2-core machine) and **15 GB of cloud NVMe storage**.

---

## 🚀 Why Use Codespaces for SpacePipe?
1. **Zero Impact on Local Storage**: Large audio downloads, uncompressed WAV cuts, and multi-gigabyte models stay in the cloud and never touch your local drive.
2. **Gigabit Data Center Speeds**: Audio downloads from GitHub Releases or Twitter at **200 to 500 MB/s**.
3. **Use SpacePipe Studio from Any Browser / Tablet**: Runs in Chrome, Brave, Safari, or an iPad with full audio scrub bars, waveform rendering, and AI Copilot.

---

## 🛠️ How to Launch SpacePipe in Codespaces

1. Navigate to your repository on GitHub.
2. Click the green **`<> Code`** button.
3. Select the **Codespaces** tab.
4. Click **"Create codespace on master"**.
5. The cloud container will boot up in under 60 seconds and automatically install FFmpeg, Python, Node.js, and dependencies.
6. In the integrated terminal, run:
   ```bash
   npm run dev
   ```
7. Click the notification: **`Open in Browser`** (or open the Ports tab and click Port 5000). SpacePipe Studio opens in your browser over a secure HTTPS link.

---

## ⏱️ Preserving Your 60 Free Monthly Hours (Crucial!)

To prevent wasting hours when you step away from your computer:
1. Go to your GitHub **Settings** ➔ **Codespaces** (https://github.com/settings/codespaces).
2. Set **Default idle timeout** to **15 minutes**.
3. If you close your browser tab or become inactive for 15 minutes, the cloud machine automatically suspends itself, saving your quota.
