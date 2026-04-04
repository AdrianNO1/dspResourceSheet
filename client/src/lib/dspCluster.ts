import type { SolarSystem, SystemDistance } from "./types";

export type ParsedClusterAddress = {
  clusterAddress: string;
  clusterSeed: number;
  clusterStarCount: number;
  clusterResourceCode: string | null;
  clusterSuffix: string | null;
};

export type GeneratedClusterSystem = {
  index: number;
  name: string;
  x: number;
  y: number;
  z: number;
};

type Vector3 = {
  x: number;
  y: number;
  z: number;
};

type StarType = "main" | "giant" | "white_dwarf" | "neutron" | "black_hole";

const INT_MAX = 2147483647;

class DspRandom {
  private inext = 0;
  private inextp = 31;
  private readonly seedArray = new Array<number>(56).fill(0);

  constructor(seed: number) {
    let num1 = 161803398 - Math.abs(seed);
    this.seedArray[55] = num1;
    let num2 = 1;
    for (let index1 = 1; index1 < 55; index1 += 1) {
      const index2 = (21 * index1) % 55;
      this.seedArray[index2] = num2;
      num2 = num1 - num2;
      if (num2 < 0) {
        num2 += INT_MAX;
      }
      num1 = this.seedArray[index2];
    }
    for (let index3 = 1; index3 < 5; index3 += 1) {
      for (let index4 = 1; index4 < 56; index4 += 1) {
        let value = this.seedArray[index4] - this.seedArray[1 + ((index4 + 30) % 55)];
        if (value < 0) {
          value += INT_MAX;
        }
        this.seedArray[index4] = value;
      }
    }
  }

  private sample() {
    this.inext += 1;
    if (this.inext >= 56) {
      this.inext = 1;
    }
    this.inextp += 1;
    if (this.inextp >= 56) {
      this.inextp = 1;
    }
    let num = this.seedArray[this.inext] - this.seedArray[this.inextp];
    if (num < 0) {
      num += INT_MAX;
    }
    this.seedArray[this.inext] = num;
    return num * (1 / INT_MAX);
  }

  nextF64() {
    return this.sample();
  }

  nextF32() {
    return this.sample();
  }

  nextI32(maxValue: number) {
    return Math.floor(this.sample() * maxValue);
  }

  nextUsize() {
    return Math.floor(this.sample() * INT_MAX);
  }

  nextSeed() {
    return Math.floor(this.sample() * INT_MAX);
  }
}

function zeroVector(): Vector3 {
  return { x: 0, y: 0, z: 0 };
}

function distanceSq(left: Vector3, right: Vector3) {
  const dx = right.x - left.x;
  const dy = right.y - left.y;
  const dz = right.z - left.z;
  return dx * dx + dy * dy + dz * dz;
}

function distance(left: Vector3, right: Vector3) {
  return Math.sqrt(distanceSq(left, right));
}

function checkCollision(points: Vector3[], point: Vector3, minDist: number) {
  const minDistSq = minDist * minDist;
  return points.some((entry) => distanceSq(entry, point) < minDistSq);
}

function randomPoses(
  output: Vector3[],
  seed: number,
  maxCount: number,
  minDist: number,
  stepDiff: number,
  flatten: number,
) {
  const random = new DspRandom(seed);
  const num1 = random.nextF64();
  const drunk: Vector3[] = [];
  output.push(zeroVector());
  const num2 = 6;
  const num3 = 8;
  const num4 = num3 - num2;
  const num5 = Math.floor(num1 * num4 + num2);
  for (let outer = 0; outer < num5; outer += 1) {
    for (let index = 0; index < 256; index += 1) {
      const num7 = random.nextF64() * 2 - 1;
      const num8 = (random.nextF64() * 2 - 1) * flatten;
      const num9 = random.nextF64() * 2 - 1;
      const num10 = random.nextF64();
      const d = num7 * num7 + num8 * num8 + num9 * num9;
      if (d <= 1 && d >= 1e-8) {
        const num11 = Math.sqrt(d);
        const num12 = (num10 * stepDiff + minDist) / num11;
        const point = { x: num7 * num12, y: num8 * num12, z: num9 * num12 };
        if (!checkCollision(output, point, minDist)) {
          drunk.push(point);
          output.push(point);
          if (output.length >= maxCount) {
            return;
          }
          break;
        }
      }
    }
  }
  for (let outer = 0; outer < 256; outer += 1) {
    for (let index = 0; index < drunk.length; index += 1) {
      if (random.nextF64() <= 0.7) {
        for (let inner = 0; inner < 256; inner += 1) {
          const num15 = random.nextF64() * 2 - 1;
          const num16 = (random.nextF64() * 2 - 1) * flatten;
          const num17 = random.nextF64() * 2 - 1;
          const num18 = random.nextF64();
          const d = num15 * num15 + num16 * num16 + num17 * num17;
          if (d <= 1 && d >= 1e-8) {
            const num19 = Math.sqrt(d);
            const num20 = (num18 * stepDiff + minDist) / num19;
            const newPoint = {
              x: drunk[index].x + num15 * num20,
              y: drunk[index].y + num16 * num20,
              z: drunk[index].z + num17 * num20,
            };
            if (!checkCollision(output, newPoint, minDist)) {
              drunk[index] = newPoint;
              output.push(newPoint);
              if (output.length >= maxCount) {
                return;
              }
              break;
            }
          }
        }
      }
    }
  }
}

function generateTempPoses(
  seed: number,
  targetCount: number,
  iterCount: number,
  minDist: number,
  minStepLen: number,
  maxStepLen: number,
  flatten: number,
) {
  const output: Vector3[] = [];
  const actualIterCount = Math.min(16, Math.max(1, iterCount));
  randomPoses(
    output,
    seed,
    targetCount * actualIterCount,
    minDist,
    maxStepLen - minStepLen,
    flatten,
  );

  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (index % iterCount !== 0) {
      output.splice(index, 1);
    }
    if (output.length <= targetCount) {
      break;
    }
  }

  return output;
}

function parseNameSeed(seed: number, starType: StarType) {
  const random = new DspRandom(seed);
  const seed1 = random.nextSeed();
  const num1 = random.nextF64();
  if (starType === "giant") {
    const num2 = random.nextF64();
    if (num2 < 0.4) {
      return randomGiantStarNameFromRawNames(seed1);
    }
    if (num2 < 0.7) {
      return randomGiantStarNameWithConstellationAlpha(seed1);
    }
    return randomGiantStarNameWithFormat(seed1);
  }
  if (starType === "neutron") {
    return randomNeutronStarNameWithFormat(seed1);
  }
  if (starType === "black_hole") {
    return randomBlackHoleNameWithFormat(seed1);
  }
  if (num1 < 0.6) {
    return randomStarNameFromRawNames(seed1);
  }
  if (num1 < 0.93) {
    return randomStarNameWithConstellationAlpha(seed1);
  }
  return randomStarNameWithConstellationNumber(seed1);
}

function uniqueStarName(seed: number, starType: StarType, existingNames: string[]) {
  const random = new DspRandom(seed);
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const name = parseNameSeed(random.nextSeed(), starType);
    if (!existingNames.includes(name)) {
      return name;
    }
  }
  return "XStar";
}

function randomGiantStarNameWithConstellationAlpha(seed: number) {
  const random = new DspRandom(seed);
  const num1 = random.nextUsize();
  const num2 = random.nextI32(11) + 15;
  const num3 = random.nextI32(26);
  return `${130 + num2 + num3} ${CONSTELLATIONS[num1 % CONSTELLATIONS.length]}`;
}

function randomGiantStarNameWithFormat(seed: number) {
  const random = new DspRandom(seed);
  const index = random.nextUsize() % GIANT_NAME_FORMATS.length;
  return GIANT_NAME_FORMATS[index](random.nextI32(10000), random.nextI32(100));
}

function randomNeutronStarNameWithFormat(seed: number) {
  const random = new DspRandom(seed);
  const index = random.nextUsize() % NEUTRON_STAR_NAME_FORMATS.length;
  return NEUTRON_STAR_NAME_FORMATS[index](random.nextI32(24), random.nextI32(60), random.nextI32(60));
}

function randomBlackHoleNameWithFormat(seed: number) {
  const random = new DspRandom(seed);
  const index = random.nextUsize() % BLACK_HOLE_NAME_FORMATS.length;
  return BLACK_HOLE_NAME_FORMATS[index](random.nextI32(24), random.nextI32(60), random.nextI32(60));
}

function randomStarNameFromRawNames(seed: number) {
  const random = new DspRandom(seed);
  return RAW_STAR_NAMES[random.nextUsize() % RAW_STAR_NAMES.length];
}

function randomStarNameWithConstellationAlpha(seed: number) {
  const random = new DspRandom(seed);
  const constellation = CONSTELLATIONS[random.nextUsize() % CONSTELLATIONS.length];
  const alpha = ALPHABETA[random.nextUsize() % ALPHABETA.length];
  return `${alpha} ${constellation}`;
}

function randomStarNameWithConstellationNumber(seed: number) {
  const random = new DspRandom(seed);
  const constellation = CONSTELLATIONS[random.nextUsize() % CONSTELLATIONS.length];
  const number = random.nextI32(48) + 27;
  return `${number} ${constellation}`;
}

function randomGiantStarNameFromRawNames(seed: number) {
  const random = new DspRandom(seed);
  return RAW_GIANT_NAMES[random.nextUsize() % RAW_GIANT_NAMES.length];
}

export function parseClusterAddress(address: string): ParsedClusterAddress {
  const trimmed = address.trim();
  const match = /^(\d+)-(\d+)-(\d+)(?:-(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new Error("Cluster address format must look like 07198444-64-799-10.");
  }

  const clusterSeed = Number(match[1]);
  const clusterStarCount = Number(match[2]);
  if (!Number.isInteger(clusterSeed) || !Number.isInteger(clusterStarCount) || clusterStarCount <= 0) {
    throw new Error("Cluster address contains an invalid seed or star count.");
  }

  return {
    clusterAddress: trimmed,
    clusterSeed,
    clusterStarCount,
    clusterResourceCode: match[3] ?? null,
    clusterSuffix: match[4] ?? null,
  };
}

export function generateClusterSystems(seedOrParsed: number | ParsedClusterAddress, starCountArg?: number) {
  const clusterSeed = typeof seedOrParsed === "number" ? seedOrParsed : seedOrParsed.clusterSeed;
  const clusterStarCount =
    typeof seedOrParsed === "number"
      ? Number(starCountArg ?? 0)
      : seedOrParsed.clusterStarCount;

  if (!Number.isInteger(clusterSeed) || !Number.isInteger(clusterStarCount) || clusterStarCount <= 0) {
    throw new Error("A valid cluster seed and star count are required.");
  }

  const galaxyRandom = new DspRandom(clusterSeed);
  const poses = generateTempPoses(galaxyRandom.nextSeed(), clusterStarCount, 4, 2, 2.3, 3.5, 0.18);
  const starCount = poses.length;

  const num1 = galaxyRandom.nextF32();
  const num2 = galaxyRandom.nextF32();
  const num3 = galaxyRandom.nextF32();
  const num4 = galaxyRandom.nextF32();
  const num5 = Math.ceil(0.01 * starCount + num1 * 0.3);
  const num6 = Math.ceil(0.01 * starCount + num2 * 0.3);
  const num7 = Math.ceil(0.016 * starCount + num3 * 0.4);
  const num8 = Math.ceil(0.013 * starCount + num4 * 1.3);
  const num9 = starCount - num5;
  const num10 = num9 - num6;
  const num11 = num10 - num7;
  const num12 = Math.floor((num11 - 1) / num8);
  const num13 = Math.floor(num12 / 2);

  const systems: Array<GeneratedClusterSystem & { starType: StarType; nameSeed: number }> = [];
  const usedNames: string[] = [];

  for (let index = 0; index < poses.length; index += 1) {
    const position = poses[index];
    const seed = galaxyRandom.nextSeed();
    const starRandom = new DspRandom(seed);
    const nameSeed = starRandom.nextSeed();

    let starType: StarType = "main";
    if (index === 0) {
      starType = "main";
    } else if (index % num12 === num13) {
      starType = "giant";
    } else if (index >= num9) {
      starType = "black_hole";
    } else if (index >= num10) {
      starType = "neutron";
    } else if (index >= num11) {
      starType = "white_dwarf";
    }

    const name = uniqueStarName(nameSeed, starType, usedNames);
    usedNames.push(name);

    systems.push({
      index,
      name,
      x: position.x,
      y: position.y,
      z: position.z,
      starType,
      nameSeed,
    });
  }

  return systems.map(({ starType: _starType, nameSeed: _nameSeed, ...system }) => system);
}

export function getSystemDistanceLy(
  left: Pick<SolarSystem, "id" | "generated_x" | "generated_y" | "generated_z"> | null | undefined,
  right: Pick<SolarSystem, "id" | "generated_x" | "generated_y" | "generated_z"> | null | undefined,
  manualDistances?: SystemDistance[] | Map<string, SystemDistance>,
) {
  if (!left || !right) {
    return null;
  }
  if (left.id === right.id) {
    return 0;
  }
  if (
    left.generated_x !== null &&
    left.generated_y !== null &&
    left.generated_z !== null &&
    right.generated_x !== null &&
    right.generated_y !== null &&
    right.generated_z !== null
  ) {
    return distance(
      { x: left.generated_x, y: left.generated_y, z: left.generated_z },
      { x: right.generated_x, y: right.generated_y, z: right.generated_z },
    );
  }
  if (!manualDistances) {
    return null;
  }

  const key = [left.id, right.id].sort().join("::");
  if (manualDistances instanceof Map) {
    return manualDistances.get(key)?.distance_ly ?? null;
  }
  const entry = manualDistances.find(
    (distanceEntry) =>
      [distanceEntry.system_a_id, distanceEntry.system_b_id].sort().join("::") === key,
  );
  return entry?.distance_ly ?? null;
}

export function getSystemDistanceFromCoordinates(
  left: Pick<SolarSystem, "generated_x" | "generated_y" | "generated_z">,
  right: Pick<SolarSystem, "generated_x" | "generated_y" | "generated_z">,
) {
  if (
    left.generated_x === null ||
    left.generated_y === null ||
    left.generated_z === null ||
    right.generated_x === null ||
    right.generated_y === null ||
    right.generated_z === null
  ) {
    return null;
  }

  return distance(
    { x: left.generated_x, y: left.generated_y, z: left.generated_z },
    { x: right.generated_x, y: right.generated_y, z: right.generated_z },
  );
}

const GIANT_NAME_FORMATS = [
  (i1: number, i2: number) => `HD ${String(i1).padStart(4, "0")}${String(i2).padStart(2, "0")}`,
  (i1: number, i2: number) => `HDE ${String(i1).padStart(4, "0")}${String(i2).padStart(2, "0")}`,
  (i1: number) => `HR ${String(i1).padStart(4, "0")}`,
  (i1: number) => `HV ${String(i1).padStart(4, "0")}`,
  (i1: number, i2: number) => `LBV ${String(i1).padStart(4, "0")}-${String(i2).padStart(2, "0")}`,
  (i1: number) => `NSV ${String(i1).padStart(4, "0")}`,
  (i1: number, i2: number) => `YSC ${String(i1).padStart(4, "0")}-${String(i2).padStart(2, "0")}`,
] as const;

const NEUTRON_STAR_NAME_FORMATS = [
  (i1: number, i2: number, i3: number) => `NTR J${String(i1).padStart(2, "0")}${String(i2).padStart(2, "0")}+${String(i3).padStart(2, "0")}`,
  (i1: number, i2: number, i3: number) => `NTR J${String(i1).padStart(2, "0")}${String(i2).padStart(2, "0")}-${String(i3).padStart(2, "0")}`,
] as const;

const BLACK_HOLE_NAME_FORMATS = [
  (i1: number, i2: number, i3: number) => `DSR J${String(i1).padStart(2, "0")}${String(i2).padStart(2, "0")}+${String(i3).padStart(2, "0")}`,
  (i1: number, i2: number, i3: number) => `DSR J${String(i1).padStart(2, "0")}${String(i2).padStart(2, "0")}-${String(i3).padStart(2, "0")}`,
] as const;

const RAW_GIANT_NAMES = [
  "AH Scorpii", "Aldebaran", "Alpha Herculis", "Antares", "Arcturus", "AV Persei", "BC Cygni", "Betelgeuse",
  "BI Cygni", "BO Carinae", "Canopus", "CE Tauri", "CK Carinae", "CW Leonis", "Deneb", "Epsilon Aurigae",
  "Eta Carinae", "EV Carinae", "IX Carinae", "KW Sagittarii", "KY Cygni", "Mira", "Mu Cephei", "NML Cygni",
  "NR Vulpeculae", "PZ Cassiopeiae", "R Doradus", "R Leporis", "Rho Cassiopeiae", "Rigel", "RS Persei", "RT Carinae",
  "RU Virginis", "RW Cephei", "S Cassiopeiae", "S Cephei", "S Doradus", "S Persei", "SU Persei", "TV Geminorum",
  "U Lacertae", "UY Scuti", "V1185 Scorpii", "V354 Cephei", "V355 Cepheus", "V382 Carinae", "V396 Centauri",
  "V437 Scuti", "V509 Cassiopeiae", "V528 Carinae", "V602 Carinae", "V648 Cassiopeiae", "V669 Cassiopeiae",
  "V838 Monocerotis", "V915 Scorpii", "VV Cephei", "VX Sagittarii", "VY Canis Majoris", "WOH G64", "XX Persei",
] as const;

const ALPHABETA = [
  "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda",
] as const;

const CONSTELLATIONS = [
  "Andromedae", "Antliae", "Apodis", "Aquarii", "Aquilae", "Arae", "Arietis", "Aurigae", "Bootis", "Caeli",
  "Camelopardalis", "Cancri", "Canum Venaticorum", "Canis Majoris", "Canis Minoris", "Capricorni", "Carinae",
  "Cassiopeiae", "Centauri", "Cephei", "Ceti", "Chamaeleontis", "Circini", "Columbae", "Comae Berenices",
  "Coronae Australis", "Coronae Borealis", "Corvi", "Crateris", "Crucis", "Cygni", "Delphini", "Doradus",
  "Draconis", "Equulei", "Eridani", "Fornacis", "Geminorum", "Gruis", "Herculis", "Horologii", "Hydrae",
  "Hydri", "Indi", "Lacertae", "Leonis", "Leonis Minoris", "Leporis", "Librae", "Lupi", "Lyncis", "Lyrae",
  "Mensae", "Microscopii", "Monocerotis", "Muscae", "Normae", "Octantis", "Ophiuchii", "Orionis", "Pavonis",
  "Pegasi", "Persei", "Phoenicis", "Pictoris", "Piscium", "Piscis Austrini", "Puppis", "Pyxidis", "Reticuli",
  "Sagittae", "Sagittarii", "Scorpii", "Sculptoris", "Scuti", "Serpentis", "Sextantis", "Tauri", "Telescopii",
  "Trianguli", "Trianguli Australis", "Tucanae", "Ursae Majoris", "Ursae Minoris", "Velorum", "Virginis",
  "Volantis", "Vulpeculae",
] as const;

const RAW_STAR_NAMES = [
  "Acamar", "Achernar", "Achird", "Acrab", "Acrux", "Acubens", "Adhafera", "Adhara", "Adhil", "Agena",
  "Aladfar", "Albaldah", "Albali", "Albireo", "Alchiba", "Alcor", "Alcyone", "Alderamin", "Aldhibain", "Aldib",
  "Alfecca", "Alfirk", "Algedi", "Algenib", "Algenubi", "Algieba", "Algjebbath", "Algol", "Algomeyla", "Algorab",
  "Alhajoth", "Alhena", "Alifa", "Alioth", "Alkaid", "Alkalurops", "Alkaphrah", "Alkes", "Alkhiba", "Almach",
  "Almeisan", "Almuredin", "AlNa'ir", "Alnasl", "Alnilam", "Alnitak", "Alniyat", "Alphard", "Alphecca", "Alpheratz",
  "Alrakis", "Alrami", "Alrescha", "AlRijil", "Alsahm", "Alsciaukat", "Alshain", "Alshat", "Alshemali", "Alsuhail",
  "Altair", "Altais", "Alterf", "Althalimain", "AlTinnin", "Aludra", "AlulaAustralis", "AlulaBorealis", "Alwaid",
  "Alwazn", "Alya", "Alzirr", "AmazonStar", "Ancha", "Anchat", "AngelStern", "Angetenar", "Ankaa", "Anser",
  "Antecanis", "Apollo", "Arich", "Arided", "Arietis", "Arkab", "ArkebPrior", "Arneb", "Arrioph", "AsadAustralis",
  "Ascella", "Aschere", "AsellusAustralis", "AsellusBorealis", "AsellusPrimus", "Ashtaroth", "Asmidiske",
  "Aspidiske", "Asterion", "Asterope", "Asuia", "Athafiyy", "Atik", "Atlas", "Atria", "Auva", "Avior",
  "Azelfafage", "Azha", "Azimech", "BatenKaitos", "Becrux", "Beid", "Bellatrix", "Benatnasch", "Biham", "Botein",
  "Brachium", "Bunda", "Cajam", "Calbalakrab", "Calx", "Canicula", "Capella", "Caph", "Castor", "Castula",
  "Cebalrai", "Ceginus", "Celaeno", "Chara", "Chertan", "Choo", "Clava", "CorCaroli", "CorHydrae", "CorLeonis",
  "Cornu", "CorScorpii", "CorSepentis", "CorTauri", "Coxa", "Cursa", "Cymbae", "Cynosaura", "Dabih", "DenebAlgedi",
  "DenebDulfim", "DenebelOkab", "DenebKaitos", "DenebOkab", "Denebola", "Dhalim", "Dhur", "Diadem", "Difda",
  "DifdaalAuwel", "Dnoces", "Dubhe", "Dziban", "Dzuba", "Edasich", "ElAcola", "Elacrab", "Electra", "Elgebar",
  "Elgomaisa", "ElKaprah", "ElKaridab", "Elkeid", "ElKhereb", "Elmathalleth", "Elnath", "ElPhekrah", "Eltanin",
  "Enif", "Erakis", "Errai", "FalxItalica", "Fidis", "Fomalhaut", "Fornacis", "FumAlSamakah", "Furud", "Gacrux",
  "Gallina", "GarnetStar", "Gemma", "Genam", "Giausar", "GiedePrime", "Giedi", "Gienah", "Gienar", "Gildun",
  "Girtab", "Gnosia", "Gomeisa", "Gorgona", "Graffias", "Hadar", "Hamal", "Haris", "Hasseleh", "Hastorang",
  "Hatysa", "Heka", "Hercules", "Heze", "Hoedus", "Homam", "HyadumPrimus", "Icalurus", "Iclarkrav", "Izar",
  "Jabbah", "Jewel", "Jugum", "Juza", "Kabeleced", "Kaff", "Kaffa", "Kaffaljidma", "Kaitain", "KalbalAkrab",
  "Kat", "KausAustralis", "KausBorealis", "KausMedia", "Keid", "KeKouan", "Kelb", "Kerb", "Kerbel", "KiffaBoraelis",
  "Kitalpha", "Kochab", "Kornephoros", "Kraz", "Ksora", "Kuma", "Kurhah", "Kursa", "Lesath", "Maasym", "Maaz",
  "Mabsuthat", "Maia", "Marfik", "Markab", "Marrha", "Matar", "Mebsuta", "Megres", "Meissa", "Mekbuda",
  "Menkalinan", "Menkar", "Menkent", "Menkib", "Merak", "Meres", "Merga", "Meridiana", "Merope", "Mesartim",
  "Metallah", "Miaplacidus", "Mimosa", "Minelauva", "Minkar", "Mintaka", "Mirac", "Mirach", "Miram", "Mirfak",
  "Mirzam", "Misam", "Mismar", "Mizar", "Muhlifain", "Muliphein", "Muphrid", "Muscida", "NairalSaif", "NairalZaurak",
  "Naos", "Nash", "Nashira", "Navi", "Nekkar", "Nicolaus", "Nihal", "Nodus", "Nunki", "Nusakan", "OculusBoreus",
  "Okda", "Osiris", "OsPegasi", "Palilicium", "Peacock", "Phact", "Phecda", "Pherkad", "PherkadMinor", "Pherkard",
  "Phoenice", "Phurad", "Pishpai", "Pleione", "Polaris", "Pollux", "Porrima", "Postvarta", "Praecipua", "Procyon",
  "Propus", "Protrygetor", "Pulcherrima", "Rana", "RanaSecunda", "Rasalas", "Rasalgethi", "Rasalhague",
  "Rasalmothallah", "RasHammel", "Rastaban", "Reda", "Regor", "Regulus", "Rescha", "RigilKentaurus", "RiglalAwwa",
  "Rotanen", "Ruchba", "Ruchbah", "Rukbat", "Rutilicus", "Saak", "Sabik", "Sadachbia", "Sadalbari", "Sadalmelik",
  "Sadalsuud", "Sadatoni", "Sadira", "Sadr", "Saidak", "Saiph", "Salm", "Sargas", "Sarin", "Sartan", "Sceptrum",
  "Scheat", "Schedar", "Scheddi", "Schemali", "Scutulum", "SeatAlpheras", "Segin", "Seginus", "Shaula", "Shedir",
  "Sheliak", "Sheratan", "Singer", "Sirius", "Sirrah", "Situla", "Skat", "Spica", "Sterope", "Subra", "Suha",
  "Suhail", "SuhailHadar", "SuhailRadar", "Suhel", "Sulafat", "Superba", "Svalocin", "Syrma", "Tabit", "Tais",
  "Talitha", "TaniaAustralis", "TaniaBorealis", "Tarazed", "Tarf", "TaTsun", "Taygeta", "Tegmen", "Tejat",
  "TejatPrior", "Terebellum", "Theemim", "Thuban", "Tolimann", "Tramontana", "Tsih", "Tureis", "Unukalhai", "Vega",
  "Venabulum", "Venator", "Vendemiatrix", "Vespertilio", "Vildiur", "Vindemiatrix", "Wasat", "Wazn", "YedPosterior",
  "YedPrior", "Zaniah", "Zaurak", "Zavijava", "ZenithStar", "Zibel", "Zosma", "Zubenelakrab", "ZubenElgenubi",
  "Zubeneschamali", "ZubenHakrabi", "Zubra",
] as const;
