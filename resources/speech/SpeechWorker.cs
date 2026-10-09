using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Speech.Recognition;

namespace SeniorEngineerSpeech
{
    class Program
    {
        private static SpeechRecognitionEngine engine;
        private static volatile bool isRunning = true;

        static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Console.InputEncoding = Encoding.UTF8;

            try
            {
                // Select recognizer by culture or default
                RecognizerInfo recognizer = null;
                if (args.Length > 0 && !string.IsNullOrEmpty(args[0]))
                {
                    string target = args[0].Trim();
                    foreach (var ri in SpeechRecognitionEngine.InstalledRecognizers())
                    {
                        if (ri.Culture.Name.Equals(target, StringComparison.OrdinalIgnoreCase) ||
                            ri.Culture.TwoLetterISOLanguageName.Equals(target, StringComparison.OrdinalIgnoreCase))
                        {
                            recognizer = ri;
                            break;
                        }
                    }
                }

                engine = recognizer != null ? new SpeechRecognitionEngine(recognizer) : new SpeechRecognitionEngine();

                DictationGrammar grammar = new DictationGrammar();
                grammar.Name = "dictation";
                engine.LoadGrammar(grammar);

                engine.SpeechHypothesized += (s, e) =>
                {
                    if (e.Result != null && !string.IsNullOrEmpty(e.Result.Text))
                    {
                        EmitJson("interim", e.Result.Text, e.Result.Confidence);
                    }
                };

                engine.SpeechRecognized += (s, e) =>
                {
                    if (e.Result != null && !string.IsNullOrEmpty(e.Result.Text))
                    {
                        EmitJson("final", e.Result.Text, e.Result.Confidence);
                    }
                };

                engine.SetInputToDefaultAudioDevice();
                engine.RecognizeAsync(RecognizeMode.Multiple);

                EmitJson("status", "ready", 1.0f);

                // Read stdin to know when to gracefully stop
                Thread inputThread = new Thread(() =>
                {
                    try
                    {
                        while (isRunning)
                        {
                            string line = Console.ReadLine();
                            if (line == null || line.Trim().Equals("stop", StringComparison.OrdinalIgnoreCase) || line.Trim().Equals("exit", StringComparison.OrdinalIgnoreCase))
                            {
                                isRunning = false;
                                break;
                            }
                        }
                    }
                    catch { }
                });
                inputThread.IsBackground = true;
                inputThread.Start();

                while (isRunning)
                {
                    Thread.Sleep(50);
                }

                try
                {
                    engine.RecognizeAsyncStop();
                    engine.Dispose();
                }
                catch { }

                EmitJson("status", "stopped", 1.0f);
            }
            catch (Exception ex)
            {
                EmitJson("error", ex.Message, 0.0f);
                Environment.Exit(1);
            }
        }

        private static void EmitJson(string type, string text, float confidence)
        {
            string escaped = text
                .Replace("\\", "\\\\")
                .Replace("\"", "\\\"")
                .Replace("\r", "\\r")
                .Replace("\n", "\\n")
                .Replace("\t", "\\t");

            Console.WriteLine("{\"type\":\"" + type + "\",\"text\":\"" + escaped + "\",\"confidence\":" + confidence.ToString("0.00", System.Globalization.CultureInfo.InvariantCulture) + "}");
            Console.Out.Flush();
        }
    }
}
