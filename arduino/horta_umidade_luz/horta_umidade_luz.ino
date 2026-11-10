/*
  Minha Horta — umidade do solo + luz (LDR)
  Placa: Arduino Uno

  LIGAÇÕES
    Sensor de solo: VCC -> 5V | GND -> GND | AO -> A0
    LDR (divisor de tensão):
      5V -> LDR -> A1
      A1 -> resistor 10 kΩ -> GND
      (mais luz = número maior)
    Alerta de solo seco (opcional, já montado): LED -> D8 | buzzer -> D9

  VER NA TELA
    - Monitor Serial (9600): linha com umidade, luz e valores brutos
    - Plotter Serial (Tools > Serial Plotter, 9600): gráfico ao vivo de Umidade e Luz
*/

// ===== CALIBRAÇÃO DO SOLO =====
const int SOLO_SECO    = 1023;   // sonda no ar
const int SOLO_MOLHADO = 350;    // sonda na água
const int SOLO_QUASE_SECO = 45;  // % -> LED D8 pisca
const int SOLO_SECO_PCT   = 30;  // % -> LED D8 aceso + bipe

// ===== CALIBRAÇÃO DA LUZ =====
const int LUZ_ESCURO = 50;    // bruto com o LDR coberto pela mão
const int LUZ_MAXIMA = 950;   // bruto com luz bem forte (sol/lanterna)

// ===== PINOS =====
const int PINO_SOLO = A0;
const int PINO_LDR  = A1;
const int PINO_LED_SOLO = 8;
const int PINO_BUZZER   = 9;
const bool BIPE_LIGADO  = true;

unsigned long ultimoPrint = 0, ultimoPisca = 0, ultimoBipe = 0;
bool piscaEstado = false;

int lerMedia(int pino) {
  long soma = 0;
  for (int i = 0; i < 8; i++) { soma += analogRead(pino); delay(2); }
  return soma / 8;
}

void bipe(int vezes) {
  if (!BIPE_LIGADO) return;
  for (int i = 0; i < vezes; i++) { tone(PINO_BUZZER, 2200, 120); delay(220); }
}

void setup() {
  Serial.begin(9600);
  pinMode(PINO_LED_SOLO, OUTPUT);
  pinMode(PINO_BUZZER, OUTPUT);
}

void loop() {
  int brutoLuz  = lerMedia(PINO_LDR);
  int luz       = constrain(map(brutoLuz, LUZ_ESCURO, LUZ_MAXIMA, 0, 100), 0, 100);
  int brutoSolo = lerMedia(PINO_SOLO);
  int umidade   = constrain(map(brutoSolo, SOLO_SECO, SOLO_MOLHADO, 0, 100), 0, 100);

  // alerta de solo seco (LED D8 + bipe)
  if (umidade <= SOLO_SECO_PCT) {
    digitalWrite(PINO_LED_SOLO, HIGH);
    if (ultimoBipe == 0 || millis() - ultimoBipe >= 60000) { ultimoBipe = millis(); bipe(3); }
  } else if (umidade <= SOLO_QUASE_SECO) {
    ultimoBipe = 0;
    if (millis() - ultimoPisca >= 400) { ultimoPisca = millis(); piscaEstado = !piscaEstado; }
    digitalWrite(PINO_LED_SOLO, piscaEstado);
  } else {
    ultimoBipe = 0;
    digitalWrite(PINO_LED_SOLO, LOW);
  }

  // tela: formato "Nome:valor" funciona no Monitor e no Plotter Serial
  if (millis() - ultimoPrint >= 1000) {
    ultimoPrint = millis();
    Serial.print("Umidade:");    Serial.print(umidade);
    Serial.print(",Luz:");       Serial.print(luz);
    Serial.print(",SoloBruto:"); Serial.print(brutoSolo);
    Serial.print(",LuzBruto:");  Serial.println(brutoLuz);
  }

  delay(50);
}
