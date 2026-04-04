import { useEffect, useMemo, useRef, useState } from "react";

type CardItem = {
  id: string;
  english: string;
  japanese: string;
};

type Direction = "en-to-jp" | "jp-to-en-full" | "jp-kana-to-en";

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/　/g, " ")
    .replace(/\s+/g, " ");
}

function extractKana(value: string) {
  const normalized = value.trim().replace(/（/g, "(").replace(/）/g, ")");
  const match = normalized.match(/\(([^()]+)\)\s*$/);
  return match ? normalizeText(match[1]) : null;
}

function extractKanji(value: string) {
  return normalizeText(value.replace(/\s*[（(][^）)]*[）)]\s*$/, ""));
}

function getKanaDisplay(value: string) {
  const normalized = value.trim().replace(/（/g, "(").replace(/）/g, ")");
  const match = normalized.match(/\(([^()]+)\)\s*$/);
  return match ? match[1].trim() : normalized;
}

function getJapaneseSpeechText(value: string) {
  return getKanaDisplay(value);
}

function isJapanesePromptDirection(direction: Direction) {
  return direction === "jp-to-en-full" || direction === "jp-kana-to-en";
}

function getEnglishAnswerVariants(value: string) {
  const normalized = value.trim().replace(/（/g, "(").replace(/）/g, ")");
  const variants = new Set<string>();

  const addParts = (text: string) => {
    text
      .split(/[\/,]/)
      .map((part) => normalizeText(part))
      .filter(Boolean)
      .forEach((part) => variants.add(part));
  };

  variants.add(normalizeText(normalized));

  const withoutParentheses = normalized.replace(/\s*\(([^()]+)\)\s*/g, " ").trim();
  if (withoutParentheses) {
    variants.add(normalizeText(withoutParentheses));
    addParts(withoutParentheses);
  }

  const parentheticalMatches = normalized.matchAll(/\(([^()]+)\)/g);
  for (const match of parentheticalMatches) {
    addParts(match[1]);
  }

  return variants;
}

function isAnswerCorrect(answer: string, expectedAnswer: string, direction: Direction) {
  const normalizedAnswer = normalizeText(answer);
  const normalizedExpected = normalizeText(expectedAnswer);

  if (direction === "jp-to-en-full" || direction === "jp-kana-to-en") {
    return getEnglishAnswerVariants(expectedAnswer).has(normalizedAnswer);
  }

  const kanaOnly = extractKana(expectedAnswer);
  const kanjiOnly = extractKanji(expectedAnswer);

  return (
    normalizedAnswer === normalizedExpected ||
    (kanaOnly !== null && normalizedAnswer === kanaOnly) ||
    normalizedAnswer === kanjiOnly
  );
}

function parseCards(raw: string): CardItem[] {
  return raw
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, index }) => {
      const parts = line.split("|");
      const english = (parts[0] || "").trim();
      const japanese = (parts[1] || "").trim();

      return {
        id: `${index}-${english}-${japanese}`,
        english,
        japanese,
      };
    })
    .filter((item) => item.english && item.japanese);
}

function getRandomCard<T>(items: T[]): T | null {
  if (!items.length) return null;
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

const SAMPLE_SET = `water | 水(みず)
cat | 猫(ねこ)
dog | 犬(いぬ)
book | 本(ほん)
to eat | 食べる(たべる)`;

export default function App() {
  const [rawSet, setRawSet] = useState(SAMPLE_SET);
  const [direction, setDirection] = useState<Direction>("en-to-jp");
  const [started, setStarted] = useState(false);
  const [currentRoundIds, setCurrentRoundIds] = useState<string[]>([]);
  const [nextRoundIds, setNextRoundIds] = useState<string[]>([]);
  const [currentCardId, setCurrentCardId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [speechRate, setSpeechRate] = useState(0.6);
  const [speechSupported, setSpeechSupported] = useState(false);
  const answerInputRef = useRef<HTMLInputElement | null>(null);

  const cards = useMemo(() => parseCards(rawSet), [rawSet]);

  const cardMap = useMemo(() => {
    return new Map(cards.map((card) => [card.id, card]));
  }, [cards]);

  const currentCard = useMemo(() => {
    return currentCardId ? cardMap.get(currentCardId) || null : null;
  }, [cardMap, currentCardId]);

  const unresolvedCardIds = useMemo(() => {
    return Array.from(new Set([...currentRoundIds, ...nextRoundIds]));
  }, [currentRoundIds, nextRoundIds]);

  const remainingCards = useMemo(() => {
    return unresolvedCardIds
      .map((cardId) => cardMap.get(cardId))
      .filter((card): card is CardItem => !!card);
  }, [cardMap, unresolvedCardIds]);

  const promptText = currentCard
    ? direction === "en-to-jp"
      ? currentCard.english
      : direction === "jp-to-en-full"
        ? currentCard.japanese
        : getKanaDisplay(currentCard.japanese)
    : "";

  const expectedAnswer = currentCard
    ? direction === "en-to-jp"
      ? currentCard.japanese
      : currentCard.english
    : "";

  const speakJapanesePrompt = (japaneseText: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    const textToSpeak = getJapaneseSpeechText(japaneseText);
    if (!textToSpeak) {
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    utterance.lang = "ja-JP";
    utterance.rate = speechRate;
    utterance.pitch = 1;

    const voices = window.speechSynthesis.getVoices();
    const googleVoice = voices.find(
      (voice) => voice.name.includes("Google") && voice.lang === "ja-JP"
    );
    const preferredVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("ja"));

    if (googleVoice) {
      utterance.voice = googleVoice;
    } else if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
  };

  const replayCurrentAudio = () => {
    if (!currentCard || !isJapanesePromptDirection(direction)) {
      return;
    }

    speakJapanesePrompt(currentCard.japanese);
  };

  const selectNextCard = (pool: CardItem[]) => {
    const next = getRandomCard(pool);
    setCurrentCardId(next?.id || null);
    setAnswer("");
    setFeedback(null);
  };

  const startNextRound = (upcomingRoundIds: string[]) => {
    setCurrentRoundIds([...upcomingRoundIds]);
    setNextRoundIds([]);
    selectNextCard(
      upcomingRoundIds.map((cardId) => cardMap.get(cardId)).filter((card): card is CardItem => !!card)
    );
  };

  const advanceRound = (upcomingCurrentRoundIds: string[], upcomingNextRoundIds: string[]) => {
    if (upcomingCurrentRoundIds.length > 0) {
      setCurrentRoundIds(upcomingCurrentRoundIds);
      setNextRoundIds(upcomingNextRoundIds);
      selectNextCard(
        upcomingCurrentRoundIds.map((cardId) => cardMap.get(cardId)).filter((card): card is CardItem => !!card)
      );
      return;
    }

    if (upcomingNextRoundIds.length > 0) {
      window.setTimeout(() => {
        startNextRound(upcomingNextRoundIds);
      }, 250);
      return;
    }

    setCurrentRoundIds([]);
    setNextRoundIds([]);
    setCurrentCardId(null);
    setAnswer("");
    setFeedback(null);
  };

  const resetSessionState = () => {
    setStarted(false);
    setCurrentRoundIds([]);
    setNextRoundIds([]);
    setCurrentCardId(null);
    setAnswer("");
    setFeedback(null);

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleStart = () => {
    const parsed = parseCards(rawSet);
    const parsedIds = parsed.map((card) => card.id);
    setStarted(true);
    setCurrentRoundIds(parsedIds);
    setNextRoundIds([]);
    setFeedback(null);
    setAnswer("");
    selectNextCard(parsed);
  };

  const handleCheck = () => {
    if (!currentCard) return;

    const correct = isAnswerCorrect(answer, expectedAnswer, direction);
    setFeedback(correct ? "correct" : "wrong");

    if (!correct) {
      setNextRoundIds((prev) => (prev.includes(currentCard.id) ? prev : [...prev, currentCard.id]));
      return;
    }

    const upcomingCurrentRoundIds = currentRoundIds.filter((cardId) => cardId !== currentCard.id);

    window.setTimeout(() => {
      advanceRound(upcomingCurrentRoundIds, nextRoundIds);
    }, 350);
  };

  const handleResetProgress = () => {
    setCurrentRoundIds([]);
    setNextRoundIds([]);
    setFeedback(null);
    setAnswer("");

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    if (cards.length === 0) {
      setStarted(false);
      setCurrentCardId(null);
      return;
    }

    setStarted(true);
    setCurrentRoundIds(cards.map((card) => card.id));
    selectNextCard(cards);
  };

  const handleShuffleCurrent = () => {
    if (!currentCard) {
      return;
    }

    const upcomingCurrentRoundIds = currentRoundIds.filter((cardId) => cardId !== currentCard.id);
    const upcomingNextRoundIds = nextRoundIds.includes(currentCard.id)
      ? nextRoundIds
      : [...nextRoundIds, currentCard.id];

    advanceRound(upcomingCurrentRoundIds, upcomingNextRoundIds);
  };

  const handleDirectionChange = (nextDirection: Direction) => {
    setDirection(nextDirection);
    resetSessionState();
  };

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechSupported(false);
      return;
    }

    setSpeechSupported(true);

    const loadVoices = () => {
      window.speechSynthesis.getVoices();
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.cancel();
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!started || !currentCard || !audioEnabled || !isJapanesePromptDirection(direction) || !speechSupported) {
      return;
    }

    speakJapanesePrompt(currentCard.japanese);
  }, [started, currentCardId, direction, audioEnabled, speechSupported, speechRate]);

  useEffect(() => {
    if (!started || !currentCard) {
      return;
    }

    answerInputRef.current?.focus();
  }, [started, currentCardId]);

  const allDone = started && remainingCards.length === 0;
  const audioControlsEnabled =
    speechSupported && started && !!currentCard && isJapanesePromptDirection(direction);

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
        <div className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">English ↔ Japanese Flashcards</h1>
              <p className="mt-2 text-sm text-slate-600">Add one card per line using this format:</p>
              <p className="mt-1 font-medium text-slate-800">English | 日本語(にほんご)</p>
            </div>
            <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              {cards.length} cards
            </div>
          </div>

          <label htmlFor="cards" className="mb-2 block text-sm font-medium text-slate-800">
            Word set
          </label>
          <textarea
            id="cards"
            value={rawSet}
            onChange={(e) => setRawSet(e.target.value)}
            placeholder="water | 水(みず)"
            className="min-h-[320px] w-full rounded-2xl border border-slate-300 p-4 text-base outline-none transition focus:border-slate-500"
          />

          <div className="mt-5 rounded-2xl bg-slate-100 p-4">
            <div className="text-sm font-medium text-slate-800">Direction</div>
            <div className="mt-1 text-sm text-slate-600">
              {direction === "en-to-jp"
                ? "Show English, answer in Japanese"
                : direction === "jp-to-en-full"
                  ? "Show regular Japanese (kanji + kana), answer in English"
                  : "Show kana only, answer in English"}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleDirectionChange("en-to-jp")}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  direction === "en-to-jp"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                EN → JP
              </button>
              <button
                type="button"
                onClick={() => handleDirectionChange("jp-to-en-full")}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  direction === "jp-to-en-full"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                JP → EN
              </button>
              <button
                type="button"
                onClick={() => handleDirectionChange("jp-kana-to-en")}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  direction === "jp-kana-to-en"
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              >
                JP (Kana only) → EN
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStart}
              className="rounded-2xl bg-slate-900 px-4 py-2 font-medium text-white transition hover:bg-slate-800"
            >
              Start
            </button>
            <button
              type="button"
              onClick={handleResetProgress}
              className="rounded-2xl bg-slate-200 px-4 py-2 font-medium text-slate-900 transition hover:bg-slate-300"
            >
              Reset set
            </button>
            <button
              type="button"
              onClick={() => setRawSet(SAMPLE_SET)}
              className="rounded-2xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-900 transition hover:bg-slate-50"
            >
              Load sample
            </button>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-lg">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-slate-900">Practice</h2>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={replayCurrentAudio}
                disabled={!audioControlsEnabled}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  audioControlsEnabled
                    ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                    : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                }`}
                title="Replay Japanese audio"
              >
                Replay
              </button>
              <button
                type="button"
                onClick={() => setAudioEnabled((prev) => !prev)}
                disabled={!speechSupported}
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  speechSupported
                    ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                    : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                }`}
                title={audioEnabled ? "Mute automatic Japanese audio" : "Enable automatic Japanese audio"}
              >
                {audioEnabled ? "Mute" : "Unmute"}
              </button>
              <div className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1">
                <span className="text-xs font-medium text-slate-500">{speechRate.toFixed(1)}x</span>
                <input
                  type="range"
                  min="0.4"
                  max="1"
                  step="0.1"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(Number(e.target.value))}
                  className="w-24"
                  title="Speech speed"
                />
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                {remainingCards.length} left
              </div>
            </div>
          </div>

          {!speechSupported && (
            <div className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
              Japanese voice playback is not supported in this browser.
            </div>
          )}

          {!started ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <div>
                <p className="text-lg font-semibold text-slate-900">Ready when you are</p>
                <p className="mt-2 text-sm text-slate-600">Add your words, choose direction, and press Start.</p>
              </div>
            </div>
          ) : allDone ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-3xl bg-emerald-50 p-8 text-center">
              <p className="text-2xl font-bold text-emerald-800">Set completed</p>
              <p className="mt-2 text-sm text-emerald-700">
                You guessed all cards correctly. Press Reset set to study them again.
              </p>
            </div>
          ) : currentCard ? (
            <div className="space-y-4">
              <div className="rounded-3xl bg-slate-900 p-6 text-white">
                <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-300">Prompt</div>
                <div className="text-3xl font-bold leading-tight">{promptText}</div>
              </div>

              <div>
                <label htmlFor="answer" className="mb-2 block text-sm font-medium text-slate-800">
                  Your answer
                </label>
                <input
                  ref={answerInputRef}
                  id="answer"
                  autoComplete="off"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={direction === "en-to-jp" ? "Type Japanese answer" : "Type English answer"}
                  className="h-12 w-full rounded-2xl border border-slate-300 px-4 text-base outline-none transition focus:border-slate-500"
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleCheck}
                  className="rounded-2xl bg-slate-900 px-4 py-2 font-medium text-white transition hover:bg-slate-800"
                >
                  Check answer
                </button>
                <button
                  type="button"
                  onClick={handleShuffleCurrent}
                  className="rounded-2xl border border-slate-300 bg-white px-4 py-2 font-medium text-slate-900 transition hover:bg-slate-50"
                >
                  Skip / random next
                </button>
              </div>

              {feedback === "correct" && (
                <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-700">
                  Correct. This card will not be shown again.
                </div>
              )}

              {feedback === "wrong" && (
                <div className="rounded-2xl bg-rose-50 p-4 text-rose-700">
                  <div className="font-medium">Not correct yet</div>
                  <div className="mt-2 text-sm">
                    Expected answer: <span className="font-semibold">{expectedAnswer}</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <div>
                <p className="text-lg font-semibold text-slate-900">No valid cards found</p>
                <p className="mt-2 text-sm text-slate-600">Make sure each line follows: English | 日本語(にほんご)</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
