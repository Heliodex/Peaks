# Peaks

![Screenshot of a timelapse open in Peaks](/Peaks.png)

The ultimate timelapse review tool

[peaks.heliodex.cf](https://peaks.heliodex.cf)

Peaks needs no Lapse account. It reads public and unlisted timelapses by ID through the public Lapse API, and keeps projects and reviews in your browser's local storage. The only server-side piece is `/lapse-proxy`, which streams Lapse video so the canvas can read frames for timeline previews and idle detection.

